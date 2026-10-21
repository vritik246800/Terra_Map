//! CSV export of a simulation result (Fase 7).
//!
//! `simulation_csv` is pure (unit-tested); the native save dialog (filter
//! `*.csv`) picks the path, like the `.glb` export — the frontend never
//! chooses a path.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::graph::Weight;
use super::metrics::Status;
use super::PathResult;
use crate::error::AppError;

const CSV_FILTER_NAME: &str = "Folha de cálculo CSV";
const CSV_EXTENSION: &str = "csv";
const DEFAULT_FILE_NAME: &str = "simulacao.csv";

fn weight_label(w: Weight) -> &'static str {
    match w {
        Weight::Distance => "Distância",
        Weight::Cost => "Custo",
        Weight::Latency => "Latência",
        Weight::Attenuation => "Atenuação",
    }
}

fn status_label(s: Status) -> &'static str {
    match s {
        Status::Ok => "ok",
        Status::Warn => "aviso",
        Status::Danger => "falha",
    }
}

/// Quotes a field when it holds a comma, quote or newline (RFC 4180).
pub(crate) fn field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub(crate) fn row(cells: &[&str]) -> String {
    let mut line = cells.iter().map(|c| field(c)).collect::<Vec<_>>().join(",");
    line.push_str("\r\n");
    line
}

fn fmt(v: f64) -> String {
    format!("{v:.3}")
}

/// Builds the CSV: a metrics table, then the hop-by-hop path.
pub fn simulation_csv(result: &PathResult) -> String {
    let m = &result.metrics;
    let origin = result.nodes.first().map(String::as_str).unwrap_or("");
    let destination = result.nodes.last().map(String::as_str).unwrap_or("");
    let mut out = row(&["Métrica", "Valor", "Unidade"]);
    out += &row(&["Origem", origin, ""]);
    out += &row(&["Destino", destination, ""]);
    out += &row(&["Critério", weight_label(result.weight), ""]);
    out += &row(&["Comprimento", &fmt(m.length_m), "m"]);
    out += &row(&["Latência", &fmt(m.latency_ms), "ms"]);
    let bandwidth = m.bandwidth_mbps.map(fmt).unwrap_or_default();
    out += &row(&["Débito (gargalo)", &bandwidth, "Mbps"]);
    out += &row(&["Custo", &fmt(m.cost), "€"]);
    out += &row(&["Atenuação", &fmt(m.attenuation_db), "dB"]);
    if let Some(lb) = &m.link_budget {
        out += &row(&["Potência emitida", &fmt(lb.ptx_dbm), "dBm"]);
        out += &row(&["Potência recebida", &fmt(lb.prx_dbm), "dBm"]);
        out += &row(&["Sensibilidade", &fmt(lb.sensitivity_dbm), "dBm"]);
        out += &row(&["Folga", &fmt(lb.headroom_db), "dB"]);
        out += &row(&["Link budget", status_label(lb.status), ""]);
    }
    out += "\r\n";
    out += &row(&["Passo", "Nó", "Cabo de chegada"]);
    for (i, node) in result.nodes.iter().enumerate() {
        let cable = if i == 0 { "" } else { &result.edges[i - 1] };
        out += &row(&[&(i + 1).to_string(), node, cable]);
    }
    out
}

/// Writes the CSV (unit-testable half of the dialog flow).
pub fn write_csv(path: &Path, csv: &str) -> Result<(), AppError> {
    std::fs::write(path, csv)?;
    Ok(())
}

/// Native save dialog (filter `*.csv`) + write. `Ok(None)` = user cancelled.
pub fn save_csv_with_dialog(
    app: &AppHandle,
    result: &PathResult,
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(CSV_FILTER_NAME, &[CSV_EXTENSION])
        .set_file_name(DEFAULT_FILE_NAME)
        .blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file
        .as_path()
        .ok_or(AppError::InvalidFilePath)?
        .to_path_buf();
    write_csv(&path, &simulation_csv(result))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::metrics::{LinkBudget, PathMetrics};

    fn result() -> PathResult {
        PathResult {
            nodes: vec!["olt".into(), "spl,1".into(), "onu".into()],
            edges: vec!["c1".into(), "c2".into()],
            weight: Weight::Distance,
            total_weight: 150.0,
            metrics: PathMetrics {
                length_m: 150.0,
                latency_ms: 1.0,
                bandwidth_mbps: Some(1000.0),
                cost: 180.0,
                attenuation_db: 18.0,
                link_budget: Some(LinkBudget {
                    ptx_dbm: 5.0,
                    gain_db: 0.0,
                    loss_db: 18.0,
                    margin_db: 3.0,
                    prx_dbm: -16.0,
                    sensitivity_dbm: -28.0,
                    headroom_db: 12.0,
                    status: Status::Ok,
                }),
            },
        }
    }

    #[test]
    fn csv_has_metrics_and_hops() {
        let csv = simulation_csv(&result());
        assert!(csv.starts_with("Métrica,Valor,Unidade\r\n"));
        assert!(csv.contains("Comprimento,150.000,m\r\n"));
        assert!(csv.contains("Link budget,ok,\r\n"));
        assert!(csv.contains("1,olt,\r\n"));
        assert!(csv.contains("3,onu,c2\r\n"));
    }

    #[test]
    fn csv_quotes_fields_with_commas() {
        let csv = simulation_csv(&result());
        assert!(csv.contains("2,\"spl,1\",c1\r\n"));
    }

    #[test]
    fn csv_without_bandwidth_or_budget() {
        let mut r = result();
        r.metrics.bandwidth_mbps = None;
        r.metrics.link_budget = None;
        let csv = simulation_csv(&r);
        assert!(csv.contains("Débito (gargalo),,Mbps\r\n"));
        assert!(!csv.contains("Link budget"));
    }

    #[test]
    fn write_csv_round_trip() {
        let path = std::env::temp_dir().join("terra-map-test-simulacao.csv");
        write_csv(&path, "a,b\r\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a,b\r\n");
        let _ = std::fs::remove_file(path);
    }
}
