//! Dijkstra over the network graph (Fase 7, `FEATURE_SIMULADOR_REDES.md` §2.2).
//!
//! Min-heap = `BinaryHeap<Reverse<…>>` from std. Inactive nodes/cables
//! (simulated failures) are skipped by `Graph::neighbors`.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use super::graph::{Graph, Weight};

/// Path found by Dijkstra, as node/edge indices into the graph.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub nodes: Vec<usize>,
    pub edges: Vec<usize>,
    pub total: f64,
}

/// Total order over non-negative finite weights (graph validation).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Dist(f64);

impl Eq for Dist {}

impl PartialOrd for Dist {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Dist {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

/// Shortest path from `from` to `to`; `None` when unreachable or an
/// endpoint is inactive. Ties resolve deterministically (lower node index).
pub fn dijkstra(g: &Graph, from: usize, to: usize, w: Weight) -> Option<Found> {
    if !g.nodes[from].active || !g.nodes[to].active {
        return None;
    }
    let n = g.nodes.len();
    let mut dist = vec![f64::INFINITY; n];
    // prev[v] = (previous node, edge used)
    let mut prev: Vec<Option<(usize, usize)>> = vec![None; n];
    let mut heap = BinaryHeap::from([Reverse((Dist(0.0), from))]);
    dist[from] = 0.0;

    while let Some(Reverse((Dist(d), u))) = heap.pop() {
        if u == to {
            break;
        }
        if d > dist[u] {
            continue; // stale entry
        }
        for (v, e) in g.neighbors(u) {
            let nd = d + g.weight(e, v, w);
            if nd < dist[v] {
                dist[v] = nd;
                prev[v] = Some((u, e));
                heap.push(Reverse((Dist(nd), v)));
            }
        }
    }

    if dist[to].is_infinite() {
        return None;
    }
    let mut nodes = vec![to];
    let mut edges = Vec::new();
    let mut cur = to;
    while let Some((p, e)) = prev[cur] {
        nodes.push(p);
        edges.push(e);
        cur = p;
    }
    nodes.reverse();
    edges.reverse();
    Some(Found {
        nodes,
        edges,
        total: dist[to],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::graph::tests::{edge, node};
    use crate::network::graph::{EdgeInput, NetworkInput};

    fn graph(nodes: &[&str], edges: Vec<EdgeInput>) -> Graph {
        Graph::build(NetworkInput {
            nodes: nodes.iter().map(|id| node(id)).collect(),
            edges,
        })
        .unwrap()
    }

    #[test]
    fn simple_chain() {
        let g = graph(
            &["a", "b", "c"],
            vec![edge("ab", "a", "b", 3.0), edge("bc", "b", "c", 4.0)],
        );
        let found = dijkstra(&g, 0, 2, Weight::Distance).unwrap();
        assert_eq!(found.nodes, [0, 1, 2]);
        assert_eq!(found.edges, [0, 1]);
        assert_eq!(found.total, 7.0);
    }

    #[test]
    fn picks_the_cheaper_of_two_routes() {
        // a-b-d = 2 + 2; a-c-d = 1 + 10 → via b.
        let g = graph(
            &["a", "b", "c", "d"],
            vec![
                edge("ab", "a", "b", 2.0),
                edge("bd", "b", "d", 2.0),
                edge("ac", "a", "c", 1.0),
                edge("cd", "c", "d", 10.0),
            ],
        );
        let found = dijkstra(&g, 0, 3, Weight::Distance).unwrap();
        assert_eq!(found.nodes, [0, 1, 3]);
        assert_eq!(found.total, 4.0);
    }

    #[test]
    fn equal_weights_are_deterministic() {
        let g = graph(
            &["a", "b", "c", "d"],
            vec![
                edge("ab", "a", "b", 1.0),
                edge("bd", "b", "d", 1.0),
                edge("ac", "a", "c", 1.0),
                edge("cd", "c", "d", 1.0),
            ],
        );
        let first = dijkstra(&g, 0, 3, Weight::Distance).unwrap();
        assert_eq!(first.total, 2.0);
        assert_eq!(first.nodes.len(), 3);
        for _ in 0..5 {
            assert_eq!(dijkstra(&g, 0, 3, Weight::Distance).unwrap(), first);
        }
    }

    #[test]
    fn disconnected_graph_has_no_path() {
        let g = graph(&["a", "b", "c"], vec![edge("ab", "a", "b", 1.0)]);
        assert_eq!(dijkstra(&g, 0, 2, Weight::Distance), None);
    }

    #[test]
    fn failed_cable_forces_the_alternative() {
        let mut edges = vec![
            edge("ab", "a", "b", 1.0),
            edge("bd", "b", "d", 1.0),
            edge("ac", "a", "c", 5.0),
            edge("cd", "c", "d", 5.0),
        ];
        edges[1].active = false;
        let g = graph(&["a", "b", "c", "d"], edges);
        let found = dijkstra(&g, 0, 3, Weight::Distance).unwrap();
        assert_eq!(found.nodes, [0, 2, 3]);
        assert_eq!(found.total, 10.0);
    }

    #[test]
    fn failed_node_is_skipped_and_failed_endpoint_has_no_path() {
        let mut input = NetworkInput {
            nodes: vec![node("a"), node("b"), node("c")],
            edges: vec![edge("ab", "a", "b", 1.0), edge("bc", "b", "c", 1.0)],
        };
        input.nodes[1].active = false;
        let g = Graph::build(input).unwrap();
        assert_eq!(dijkstra(&g, 0, 2, Weight::Distance), None);
        assert_eq!(dijkstra(&g, 1, 2, Weight::Distance), None);
    }

    #[test]
    fn origin_equals_destination() {
        let g = graph(&["a"], vec![]);
        let found = dijkstra(&g, 0, 0, Weight::Latency).unwrap();
        assert_eq!(found.nodes, [0]);
        assert!(found.edges.is_empty());
        assert_eq!(found.total, 0.0);
    }

    #[test]
    fn criterion_changes_the_route() {
        // Short but expensive vs. long but cheap.
        let mut short = edge("short", "a", "b", 10.0);
        short
            .props
            .insert("costPerMeter".into(), serde_json::json!(100));
        let mut l1 = edge("l1", "a", "c", 30.0);
        l1.props.insert("costPerMeter".into(), serde_json::json!(1));
        let mut l2 = edge("l2", "c", "b", 30.0);
        l2.props.insert("costPerMeter".into(), serde_json::json!(1));
        let g = graph(&["a", "b", "c"], vec![short, l1, l2]);
        assert_eq!(dijkstra(&g, 0, 1, Weight::Distance).unwrap().edges, [0]);
        assert_eq!(dijkstra(&g, 0, 1, Weight::Cost).unwrap().edges, [1, 2]);
    }
}
