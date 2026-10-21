//! Network graph built from the frontend snapshot (Fase 7).
//!
//! Undirected: a cable carries traffic both ways. Edge weights per criterion
//! follow `FEATURE_SIMULADOR_REDES.md` §2.1; a node's own cost (latency,
//! insertion loss of a splitter) is paid when the path enters it.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Dynamic props as sent by the frontend (`number | string | boolean`).
pub type Props = HashMap<String, serde_json::Value>;

/// Speed of light in vacuum (m/s).
const LIGHT_SPEED: f64 = 299_792_458.0;
/// Connector loss per cable (two connectors × 0.25 dB).
pub const CONNECTOR_LOSS_DB: f64 = 0.5;
/// Props that must be non-negative (they feed Dijkstra weights or bottlenecks).
const NON_NEGATIVE_PROPS: [&str; 4] = ["latency", "attenuation", "costPerMeter", "bandwidth"];

/// Reads a numeric dynamic prop (`None` when absent or not a number).
pub fn num(props: &Props, key: &str) -> Option<f64> {
    props.get(key).and_then(serde_json::Value::as_f64)
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub id: String,
    #[serde(default)]
    pub props: Props,
    /// `false` = simulated failure (Fase 7): the node is skipped.
    #[serde(default = "yes")]
    pub active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CableType {
    Fiber,
    Copper,
    Coax,
}

impl CableType {
    /// Signal speed as a fraction of the speed of light.
    pub fn velocity_factor(self) -> f64 {
        match self {
            CableType::Fiber => 0.67,
            CableType::Copper => 0.64,
            CableType::Coax => 0.82,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub cable_type: CableType,
    /// Measured cable length in meters (the frontend's curve length).
    pub length: f64,
    #[serde(default)]
    pub props: Props,
    /// `false` = simulated failure (Fase 7): the cable is skipped.
    #[serde(default = "yes")]
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NetworkInput {
    pub nodes: Vec<NodeInput>,
    pub edges: Vec<EdgeInput>,
}

/// Dijkstra criterion (`FEATURE_SIMULADOR_REDES.md` §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Weight {
    Distance,
    Cost,
    Latency,
    Attenuation,
}

/// Validated graph with adjacency lists over node/edge indices.
#[derive(Debug)]
pub struct Graph {
    pub nodes: Vec<NodeInput>,
    pub edges: Vec<EdgeInput>,
    index: HashMap<String, usize>,
    /// Per node: `(neighbor, edge)` pairs.
    adjacency: Vec<Vec<(usize, usize)>>,
}

fn check_props(owner: &str, props: &Props) -> Result<(), AppError> {
    for key in NON_NEGATIVE_PROPS {
        if let Some(v) = num(props, key) {
            if !v.is_finite() || v < 0.0 {
                return Err(AppError::InvalidNetwork(format!(
                    "“{key}” of {owner} must be a number ≥ 0"
                )));
            }
        }
    }
    Ok(())
}

impl Graph {
    /// Builds and validates the graph (hostile input never panics).
    pub fn build(input: NetworkInput) -> Result<Self, AppError> {
        let mut index = HashMap::with_capacity(input.nodes.len());
        for (i, node) in input.nodes.iter().enumerate() {
            if index.insert(node.id.clone(), i).is_some() {
                return Err(AppError::InvalidNetwork(format!(
                    "repeated node: {}",
                    node.id
                )));
            }
            check_props(&node.id, &node.props)?;
        }

        let mut adjacency = vec![Vec::new(); input.nodes.len()];
        for (e, edge) in input.edges.iter().enumerate() {
            if !edge.length.is_finite() || edge.length < 0.0 {
                return Err(AppError::InvalidNetwork(format!(
                    "invalid length on cable {}",
                    edge.id
                )));
            }
            check_props(&edge.id, &edge.props)?;
            let (Some(&a), Some(&b)) = (index.get(&edge.from_id), index.get(&edge.to_id)) else {
                return Err(AppError::InvalidNetwork(format!(
                    "cable {} connects to a missing node",
                    edge.id
                )));
            };
            adjacency[a].push((b, e));
            if a != b {
                adjacency[b].push((a, e));
            }
        }

        Ok(Self {
            nodes: input.nodes,
            edges: input.edges,
            index,
            adjacency,
        })
    }

    pub fn node_index(&self, id: &str) -> Result<usize, AppError> {
        self.index
            .get(id)
            .copied()
            .ok_or_else(|| AppError::UnknownNode(id.to_string()))
    }

    /// Active `(neighbor, edge)` pairs of an active node.
    pub fn neighbors(&self, node: usize) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.adjacency[node]
            .iter()
            .copied()
            .filter(|&(v, e)| self.edges[e].active && self.nodes[v].active)
    }

    /// Propagation delay of a cable in milliseconds.
    pub fn propagation_ms(&self, edge: usize) -> f64 {
        let e = &self.edges[edge];
        e.length / (LIGHT_SPEED * e.cable_type.velocity_factor()) * 1000.0
    }

    /// Cable loss in dB: `length × attenuation(dB/km)` + connectors.
    pub fn cable_loss_db(&self, edge: usize) -> f64 {
        let e = &self.edges[edge];
        e.length / 1000.0 * num(&e.props, "attenuation").unwrap_or(0.0) + CONNECTOR_LOSS_DB
    }

    /// Own latency of a node or cable (`latency` prop, ms).
    pub fn node_latency(&self, node: usize) -> f64 {
        num(&self.nodes[node].props, "latency").unwrap_or(0.0)
    }

    /// Insertion loss of a node (`attenuation` prop in dB — e.g. splitters).
    pub fn node_loss_db(&self, node: usize) -> f64 {
        num(&self.nodes[node].props, "attenuation").unwrap_or(0.0)
    }

    /// Weight of crossing `edge` into node `entering` for a criterion.
    pub fn weight(&self, edge: usize, entering: usize, w: Weight) -> f64 {
        let e = &self.edges[edge];
        match w {
            Weight::Distance => e.length,
            Weight::Cost => e.length * num(&e.props, "costPerMeter").unwrap_or(0.0),
            Weight::Latency => {
                self.propagation_ms(edge)
                    + num(&e.props, "latency").unwrap_or(0.0)
                    + self.node_latency(entering)
            }
            Weight::Attenuation => self.cable_loss_db(edge) + self.node_loss_db(entering),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub fn node(id: &str) -> NodeInput {
        NodeInput {
            id: id.into(),
            props: Props::new(),
            active: true,
        }
    }

    pub fn edge(id: &str, from: &str, to: &str, length: f64) -> EdgeInput {
        EdgeInput {
            id: id.into(),
            from_id: from.into(),
            to_id: to.into(),
            cable_type: CableType::Fiber,
            length,
            props: Props::new(),
            active: true,
        }
    }

    #[test]
    fn deserializes_the_frontend_snapshot() {
        let input: NetworkInput = serde_json::from_value(json!({
            "nodes": [{ "id": "a", "kind": "olt", "props": { "latency": 1, "splitRatio": "1:32" } },
                      { "id": "b", "kind": "onu", "active": false }],
            "edges": [{ "id": "c", "fromId": "a", "toId": "b", "cableType": "fiber", "length": 10.5 }]
        }))
        .unwrap();
        let g = Graph::build(input).unwrap();
        assert!(!g.nodes[1].active);
        assert!(g.edges[0].active);
        assert_eq!(g.node_latency(0), 1.0);
    }

    #[test]
    fn rejects_duplicate_nodes_and_dangling_edges() {
        let dup = NetworkInput {
            nodes: vec![node("a"), node("a")],
            edges: vec![],
        };
        assert!(matches!(
            Graph::build(dup),
            Err(AppError::InvalidNetwork(_))
        ));

        let dangling = NetworkInput {
            nodes: vec![node("a")],
            edges: vec![edge("c", "a", "ghost", 1.0)],
        };
        assert!(matches!(
            Graph::build(dangling),
            Err(AppError::InvalidNetwork(_))
        ));
    }

    #[test]
    fn rejects_negative_lengths_and_props() {
        let bad_len = NetworkInput {
            nodes: vec![node("a"), node("b")],
            edges: vec![edge("c", "a", "b", -1.0)],
        };
        assert!(matches!(
            Graph::build(bad_len),
            Err(AppError::InvalidNetwork(_))
        ));

        let mut bad = edge("c", "a", "b", 1.0);
        bad.props.insert("costPerMeter".into(), json!(-2));
        let bad_prop = NetworkInput {
            nodes: vec![node("a"), node("b")],
            edges: vec![bad],
        };
        assert!(matches!(
            Graph::build(bad_prop),
            Err(AppError::InvalidNetwork(_))
        ));
    }

    #[test]
    fn weights_follow_the_spec_formulas() {
        let mut c = edge("c", "a", "b", 2000.0);
        c.props.insert("costPerMeter".into(), json!(1.5));
        c.props.insert("attenuation".into(), json!(0.35));
        let mut b = node("b");
        b.props.insert("latency".into(), json!(2));
        b.props.insert("attenuation".into(), json!(17));
        let g = Graph::build(NetworkInput {
            nodes: vec![node("a"), b],
            edges: vec![c],
        })
        .unwrap();

        assert_eq!(g.weight(0, 1, Weight::Distance), 2000.0);
        assert_eq!(g.weight(0, 1, Weight::Cost), 3000.0);
        // 2 km of fiber at 0.67c ≈ 0.00996 ms + node latency 2 ms.
        let latency = g.weight(0, 1, Weight::Latency);
        assert!((latency - (2.0 + 2000.0 / (LIGHT_SPEED * 0.67) * 1000.0)).abs() < 1e-12);
        // 2 km × 0.35 dB/km + 0.5 dB connectors + 17 dB splitter.
        assert!((g.weight(0, 1, Weight::Attenuation) - (0.7 + 0.5 + 17.0)).abs() < 1e-12);
    }
}
