//! Network simulator (Fase 7, `FEATURE_SIMULADOR_REDES.md`).
//!
//! The frontend sends a snapshot of the in-memory network graph (entities =
//! nodes, cables = edges, with their dynamic props and the measured cable
//! lengths); the core validates it, runs Dijkstra and computes the
//! end-to-end metrics, the optical link budget and antenna coverage.

pub mod dijkstra;
pub mod export;
pub mod graph;
pub mod metrics;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use graph::{Graph, NetworkInput, Weight};
use metrics::PathMetrics;

/// Shortest path between two nodes plus its end-to-end metrics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    /// Node ids from origin to destination.
    pub nodes: Vec<String>,
    /// Cable ids, `edges[i]` links `nodes[i]` → `nodes[i + 1]`.
    pub edges: Vec<String>,
    pub weight: Weight,
    /// Sum of the Dijkstra weights (unit of the chosen criterion).
    pub total_weight: f64,
    pub metrics: PathMetrics,
}

/// Validates the network and returns the optimal path (`None` = no path).
pub fn shortest_path(
    network: NetworkInput,
    from: &str,
    to: &str,
    weight: Weight,
) -> Result<Option<PathResult>, AppError> {
    let graph = Graph::build(network)?;
    let from_ix = graph.node_index(from)?;
    let to_ix = graph.node_index(to)?;
    let Some(found) = dijkstra::dijkstra(&graph, from_ix, to_ix, weight) else {
        return Ok(None);
    };
    let metrics = metrics::path_metrics(&graph, &found.nodes, &found.edges);
    Ok(Some(PathResult {
        nodes: found
            .nodes
            .iter()
            .map(|&i| graph.nodes[i].id.clone())
            .collect(),
        edges: found
            .edges
            .iter()
            .map(|&i| graph.edges[i].id.clone())
            .collect(),
        weight,
        total_weight: found.total,
        metrics,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use graph::tests::{edge, node};

    #[test]
    fn ftth_path_reports_ids_and_metrics() {
        let network = NetworkInput {
            nodes: vec![node("olt"), node("spl"), node("onu")],
            edges: vec![
                edge("c1", "olt", "spl", 100.0),
                edge("c2", "spl", "onu", 50.0),
            ],
        };
        let result = shortest_path(network, "olt", "onu", Weight::Distance)
            .unwrap()
            .unwrap();
        assert_eq!(result.nodes, ["olt", "spl", "onu"]);
        assert_eq!(result.edges, ["c1", "c2"]);
        assert!((result.total_weight - 150.0).abs() < 1e-9);
        assert!((result.metrics.length_m - 150.0).abs() < 1e-9);
    }

    #[test]
    fn unknown_endpoint_is_an_error() {
        let network = NetworkInput {
            nodes: vec![node("a")],
            edges: vec![],
        };
        assert!(matches!(
            shortest_path(network, "a", "zz", Weight::Distance),
            Err(AppError::UnknownNode(_))
        ));
    }

    /// Locks the JSON contract of `ui/src/net/bridge.ts` (`PathResult`).
    #[test]
    fn path_result_serializes_in_camel_case() {
        let mut olt = node("olt");
        olt.props.insert("power".into(), serde_json::json!(5));
        let mut onu = node("onu");
        onu.props
            .insert("sensitivity".into(), serde_json::json!(-28));
        let network = NetworkInput {
            nodes: vec![olt, onu],
            edges: vec![edge("c1", "olt", "onu", 10.0)],
        };
        let result = shortest_path(network, "olt", "onu", Weight::Cost)
            .unwrap()
            .unwrap();
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["weight"], "cost");
        assert!(json["totalWeight"].is_number());
        let m = &json["metrics"];
        for key in ["lengthM", "latencyMs", "cost", "attenuationDb"] {
            assert!(m[key].is_number(), "{key}");
        }
        assert!(m["bandwidthMbps"].is_null());
        assert_eq!(m["linkBudget"]["status"], "ok");
        assert!(m["linkBudget"]["headroomDb"].is_number());
    }
}
