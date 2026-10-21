//! End-to-end metrics, optical link budget and antenna coverage
//! (Fase 7, `FEATURE_SIMULADOR_REDES.md` §2.3/§2.4).

use serde::{Deserialize, Serialize};

use super::graph::{num, Graph, Props};
use crate::error::AppError;

/// Safety margin subtracted from every link budget (dB).
pub const LINK_MARGIN_DB: f64 = 3.0;
/// Headroom over the sensitivity that counts as a comfortable link (dB).
const OK_HEADROOM_DB: f64 = 3.0;
/// Receiver assumed by the coverage map: sensitivity, gain and height.
pub const RX_SENSITIVITY_DBM: f64 = -95.0;
const RX_HEIGHT_M: f64 = 1.5;
/// Cells per side of the coverage grid.
const COVERAGE_RES: usize = 48;
/// Terrain samples along each antenna → cell line of sight.
const LOS_SAMPLES: usize = 24;
/// Wave speed used for the wavelength (m/s / 1e6, so `λ = C_MHZ / f_MHz`).
const C_MHZ: f64 = 299.792_458;

/// Traffic-light status of a link or coverage cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Danger,
}

/// `ok` with ≥ 3 dB over the sensitivity, `warn` just above it, `danger` below.
pub fn classify(headroom_db: f64) -> Status {
    if headroom_db >= OK_HEADROOM_DB {
        Status::Ok
    } else if headroom_db >= 0.0 {
        Status::Warn
    } else {
        Status::Danger
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkBudget {
    pub ptx_dbm: f64,
    /// `Gtx + Grx` (dBi).
    pub gain_db: f64,
    /// Cable + connector + splitter losses along the path (dB).
    pub loss_db: f64,
    pub margin_db: f64,
    pub prx_dbm: f64,
    pub sensitivity_dbm: f64,
    /// `Prx − sensitivity`.
    pub headroom_db: f64,
    pub status: Status,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PathMetrics {
    pub length_m: f64,
    pub latency_ms: f64,
    /// Bottleneck: smallest `bandwidth` (Mbps) on the path; `None` if no element defines it.
    pub bandwidth_mbps: Option<f64>,
    /// `Σ length × costPerMeter` (€).
    pub cost: f64,
    pub attenuation_db: f64,
    /// Needs `power` on the origin and `sensitivity` on the destination.
    pub link_budget: Option<LinkBudget>,
}

/// Metrics of a path (node/edge indices as returned by Dijkstra).
pub fn path_metrics(g: &Graph, nodes: &[usize], edges: &[usize]) -> PathMetrics {
    let length_m = edges.iter().map(|&e| g.edges[e].length).sum();
    let latency_ms = edges
        .iter()
        .map(|&e| g.propagation_ms(e) + num(&g.edges[e].props, "latency").unwrap_or(0.0))
        .chain(nodes.iter().map(|&n| g.node_latency(n)))
        .sum();
    let bandwidth_mbps = nodes
        .iter()
        .map(|&n| &g.nodes[n].props)
        .chain(edges.iter().map(|&e| &g.edges[e].props))
        .filter_map(|p| num(p, "bandwidth"))
        .reduce(f64::min);
    let cost = edges
        .iter()
        .map(|&e| g.edges[e].length * num(&g.edges[e].props, "costPerMeter").unwrap_or(0.0))
        .sum();
    let attenuation_db: f64 = edges
        .iter()
        .map(|&e| g.cable_loss_db(e))
        .chain(nodes.iter().map(|&n| g.node_loss_db(n)))
        .sum();
    let link_budget = match (nodes.first(), nodes.last()) {
        (Some(&a), Some(&b)) => link_budget(&g.nodes[a].props, &g.nodes[b].props, attenuation_db),
        _ => None,
    };
    PathMetrics {
        length_m,
        latency_ms,
        bandwidth_mbps,
        cost,
        attenuation_db,
        link_budget,
    }
}

/// `Prx = Ptx + Gtx − L + Grx − M` (cable path: no free-space loss).
pub fn link_budget(origin: &Props, destination: &Props, loss_db: f64) -> Option<LinkBudget> {
    let ptx_dbm = num(origin, "power")?;
    let sensitivity_dbm = num(destination, "sensitivity")?;
    let gain_db = num(origin, "gain").unwrap_or(0.0) + num(destination, "gain").unwrap_or(0.0);
    let prx_dbm = ptx_dbm + gain_db - loss_db - LINK_MARGIN_DB;
    let headroom_db = prx_dbm - sensitivity_dbm;
    Some(LinkBudget {
        ptx_dbm,
        gain_db,
        loss_db,
        margin_db: LINK_MARGIN_DB,
        prx_dbm,
        sensitivity_dbm,
        headroom_db,
        status: classify(headroom_db),
    })
}

/// Free-space path loss: `20·log10(d_km) + 20·log10(f_MHz) + 32.44`.
pub fn fspl_db(d_km: f64, f_mhz: f64) -> f64 {
    20.0 * d_km.log10() + 20.0 * f_mhz.log10() + 32.44
}

/// Single knife-edge diffraction loss J(v) (ITU-R P.526), 0 for v ≤ −0.78.
fn knife_edge_db(v: f64) -> f64 {
    if v <= -0.78 {
        return 0.0;
    }
    6.9 + 20.0 * (((v - 0.1).powi(2) + 1.0).sqrt() + v - 0.1).log10()
}

/// Terrain heightmap as kept by the frontend (`scene/terrain.ts`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainGrid {
    pub size: f64,
    pub resolution: usize,
    /// `resolution²` heights in meters, row-major (`i = gz * res + gx`).
    pub heights: Vec<f32>,
}

impl TerrainGrid {
    pub(crate) fn validate(&self) -> Result<(), AppError> {
        if !(self.size.is_finite() && self.size > 0.0)
            || self.resolution < 2
            || self.heights.len() != self.resolution * self.resolution
            || self.heights.iter().any(|h| !h.is_finite())
        {
            return Err(AppError::InvalidNetwork("invalid terrain".into()));
        }
        Ok(())
    }

    fn contains(&self, x: f64, z: f64) -> bool {
        x.abs() <= self.size / 2.0 && z.abs() <= self.size / 2.0
    }

    /// Bilinear height, same as `Terrain.getHeight` (clamped to the border).
    pub fn height(&self, x: f64, z: f64) -> f64 {
        let res = self.resolution;
        let step = self.size / (res - 1) as f64;
        let max = (res - 1) as f64;
        let gx = ((x + self.size / 2.0) / step).clamp(0.0, max);
        let gz = ((z + self.size / 2.0) / step).clamp(0.0, max);
        let (x0, z0) = (gx.floor() as usize, gz.floor() as usize);
        let (x1, z1) = ((x0 + 1).min(res - 1), (z0 + 1).min(res - 1));
        let (tx, tz) = (gx - x0 as f64, gz - z0 as f64);
        let h = |gx: usize, gz: usize| f64::from(self.heights[gz * res + gx]);
        let top = h(x0, z0) + (h(x1, z0) - h(x0, z0)) * tx;
        let bottom = h(x0, z1) + (h(x1, z1) - h(x0, z1)) * tx;
        top + (bottom - top) * tz
    }
}

/// Antenna position (world meters) and its dynamic props.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntennaInput {
    pub x: f64,
    pub z: f64,
    /// World height of the radiating element (top of the mast).
    pub tx_height: f64,
    #[serde(default)]
    pub props: Props,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoverageResult {
    /// Cells per side; cell `i = gz * resolution + gx`.
    pub resolution: usize,
    /// The grid spans `[x − halfExtent, x + halfExtent]` (same in z) = `range`.
    pub half_extent: f64,
    /// Received power per cell; `None` outside the range circle or the terrain.
    pub prx_dbm: Vec<Option<f64>>,
    pub status: Vec<Option<Status>>,
    pub sensitivity_dbm: f64,
    /// Covered cells (`ok`/`warn`) over the cells in range (0–1).
    pub covered_ratio: f64,
}

fn required(props: &Props, key: &str) -> Result<f64, AppError> {
    match num(props, key) {
        Some(v) if v.is_finite() && (key == "power" || v > 0.0) => Ok(v),
        _ => Err(AppError::InvalidNetwork(format!(
            "the antenna needs a numeric “{key}”{}",
            if key == "power" { "" } else { " > 0" }
        ))),
    }
}

/// Coverage map of an antenna: FSPL + knife-edge diffraction over the relief.
pub fn antenna_coverage(
    antenna: &AntennaInput,
    terrain: &TerrainGrid,
) -> Result<CoverageResult, AppError> {
    terrain.validate()?;
    let power = required(&antenna.props, "power")?;
    let frequency = required(&antenna.props, "frequency")?;
    let range = required(&antenna.props, "range")?;
    let gain = num(&antenna.props, "gain").unwrap_or(0.0);
    let wavelength = C_MHZ / frequency;

    let cell = 2.0 * range / COVERAGE_RES as f64;
    let mut prx_dbm = Vec::with_capacity(COVERAGE_RES * COVERAGE_RES);
    let mut status = Vec::with_capacity(COVERAGE_RES * COVERAGE_RES);
    let (mut in_range, mut covered) = (0usize, 0usize);

    for gz in 0..COVERAGE_RES {
        for gx in 0..COVERAGE_RES {
            let x = antenna.x - range + (gx as f64 + 0.5) * cell;
            let z = antenna.z - range + (gz as f64 + 0.5) * cell;
            let d = (x - antenna.x).hypot(z - antenna.z);
            if d > range || !terrain.contains(x, z) {
                prx_dbm.push(None);
                status.push(None);
                continue;
            }
            let rx_height = terrain.height(x, z) + RX_HEIGHT_M;
            let worst_v = (1..LOS_SAMPLES)
                .map(|i| {
                    let t = i as f64 / LOS_SAMPLES as f64;
                    let ground = terrain.height(
                        antenna.x + (x - antenna.x) * t,
                        antenna.z + (z - antenna.z) * t,
                    );
                    let line = antenna.tx_height + (rx_height - antenna.tx_height) * t;
                    let (d1, d2) = (t * d, (1.0 - t) * d);
                    (ground - line) * (2.0 / wavelength * (1.0 / d1 + 1.0 / d2)).sqrt()
                })
                .fold(f64::NEG_INFINITY, f64::max);
            let diffraction = if d > 0.0 { knife_edge_db(worst_v) } else { 0.0 };
            let d_km = d.max(1.0) / 1000.0;
            let prx = power + gain - fspl_db(d_km, frequency) - diffraction - LINK_MARGIN_DB;
            let s = classify(prx - RX_SENSITIVITY_DBM);
            in_range += 1;
            if s != Status::Danger {
                covered += 1;
            }
            prx_dbm.push(Some(prx));
            status.push(Some(s));
        }
    }

    Ok(CoverageResult {
        resolution: COVERAGE_RES,
        half_extent: range,
        prx_dbm,
        status,
        sensitivity_dbm: RX_SENSITIVITY_DBM,
        covered_ratio: if in_range == 0 {
            0.0
        } else {
            covered as f64 / in_range as f64
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::graph::tests::{edge, node};
    use crate::network::graph::NetworkInput;
    use serde_json::json;

    fn props(pairs: &[(&str, f64)]) -> Props {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect()
    }

    #[test]
    fn ftth_metrics_and_link_budget() {
        let mut olt = node("olt");
        olt.props = props(&[("power", 5.0), ("bandwidth", 10000.0), ("latency", 1.0)]);
        let mut spl = node("spl");
        spl.props = props(&[("attenuation", 17.0)]);
        let mut onu = node("onu");
        onu.props = props(&[("sensitivity", -28.0), ("bandwidth", 1000.0)]);
        let mut c1 = edge("c1", "olt", "spl", 1000.0);
        c1.props = props(&[
            ("attenuation", 0.35),
            ("costPerMeter", 1.2),
            ("bandwidth", 10000.0),
        ]);
        let mut c2 = edge("c2", "spl", "onu", 1000.0);
        c2.props = c1.props.clone();
        let g = Graph::build(NetworkInput {
            nodes: vec![olt, spl, onu],
            edges: vec![c1, c2],
        })
        .unwrap();

        let m = path_metrics(&g, &[0, 1, 2], &[0, 1]);
        assert_eq!(m.length_m, 2000.0);
        assert_eq!(m.bandwidth_mbps, Some(1000.0)); // ONU is the bottleneck
        assert!((m.cost - 2400.0).abs() < 1e-9);
        // 2 × (0.35 + 0.5) + 17 = 18.7 dB
        assert!((m.attenuation_db - 18.7).abs() < 1e-9);
        assert!(m.latency_ms > 1.0 && m.latency_ms < 1.02);

        let lb = m.link_budget.unwrap();
        // 5 − 18.7 − 3 = −16.7 dBm; headroom 11.3 dB over −28.
        assert!((lb.prx_dbm + 16.7).abs() < 1e-9);
        assert!((lb.headroom_db - 11.3).abs() < 1e-9);
        assert_eq!(lb.status, Status::Ok);
    }

    #[test]
    fn link_budget_needs_power_and_sensitivity() {
        assert_eq!(
            link_budget(&props(&[]), &props(&[("sensitivity", -28.0)]), 1.0),
            None
        );
        assert_eq!(
            link_budget(&props(&[("power", 5.0)]), &props(&[]), 1.0),
            None
        );
        // 0 − 24 − 3 = −27 dBm → 1 dB over −28 → warn; 2 dB more loss → danger.
        let warn = link_budget(
            &props(&[("power", 0.0)]),
            &props(&[("sensitivity", -28.0)]),
            24.0,
        );
        assert_eq!(warn.unwrap().status, Status::Warn);
        let dead = link_budget(
            &props(&[("power", 0.0)]),
            &props(&[("sensitivity", -28.0)]),
            26.0,
        );
        assert_eq!(dead.unwrap().status, Status::Danger);
    }

    #[test]
    fn classify_thresholds() {
        assert_eq!(classify(3.0), Status::Ok);
        assert_eq!(classify(0.0), Status::Warn);
        assert_eq!(classify(-0.1), Status::Danger);
    }

    #[test]
    fn fspl_reference_value() {
        // 1 km at 1000 MHz = 0 + 60 + 32.44
        assert!((fspl_db(1.0, 1000.0) - 92.44).abs() < 1e-9);
    }

    fn flat(size: f64, res: usize) -> TerrainGrid {
        TerrainGrid {
            size,
            resolution: res,
            heights: vec![0.0; res * res],
        }
    }

    fn antenna(power: f64) -> AntennaInput {
        AntennaInput {
            x: 0.0,
            z: 0.0,
            tx_height: 10.0,
            props: props(&[
                ("power", power),
                ("gain", 0.0),
                ("frequency", 3500.0),
                ("range", 90.0),
            ]),
        }
    }

    #[test]
    fn flat_terrain_coverage_falls_with_distance() {
        let r = antenna_coverage(&antenna(20.0), &flat(200.0, 33)).unwrap();
        assert_eq!(r.prx_dbm.len(), r.resolution * r.resolution);
        let center = (r.resolution / 2) * r.resolution + r.resolution / 2;
        let edge = (r.resolution / 2) * r.resolution + 1;
        let (near, far) = (r.prx_dbm[center].unwrap(), r.prx_dbm[edge].unwrap());
        assert!(near > far);
        assert_eq!(r.prx_dbm[0], None); // grid corner is outside the range circle
        assert_eq!(r.covered_ratio, 1.0);
    }

    #[test]
    fn a_ridge_shadows_the_cells_behind_it() {
        // 21×21 grid over 200 m (10 m step): a 40 m wall at x = 30 m.
        let res = 21;
        let mut terrain = flat(200.0, res);
        for gz in 0..res {
            terrain.heights[gz * res + 13] = 40.0;
        }
        let r = antenna_coverage(&antenna(20.0), &terrain).unwrap();
        let open = antenna_coverage(&antenna(20.0), &flat(200.0, res)).unwrap();
        // A cell east of the wall (x ≈ 61 m, z ≈ 0) loses power vs. flat terrain.
        let row = r.resolution / 2;
        let gx = r.resolution * 5 / 6;
        let i = row * r.resolution + gx;
        assert!(r.prx_dbm[i].unwrap() < open.prx_dbm[i].unwrap() - 10.0);
    }

    #[test]
    fn coverage_rejects_missing_props_and_bad_terrain() {
        let mut a = antenna(20.0);
        a.props.remove("frequency");
        assert!(antenna_coverage(&a, &flat(200.0, 8)).is_err());
        let bad = TerrainGrid {
            size: 200.0,
            resolution: 8,
            heights: vec![0.0; 3],
        };
        assert!(antenna_coverage(&antenna(20.0), &bad).is_err());
    }

    #[test]
    fn terrain_height_matches_the_frontend_bilinear() {
        let terrain = TerrainGrid {
            size: 2.0,
            resolution: 2,
            heights: vec![0.0, 2.0, 4.0, 6.0],
        };
        assert_eq!(terrain.height(-1.0, -1.0), 0.0);
        assert_eq!(terrain.height(1.0, 1.0), 6.0);
        assert_eq!(terrain.height(0.0, 0.0), 3.0);
        assert_eq!(terrain.height(5.0, -5.0), 2.0); // clamped to the border
    }
}
