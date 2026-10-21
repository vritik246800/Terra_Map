//! Project report (Fase 12, `FEATURE_RELATORIOS.md`): statistics, bill of
//! materials, terrain profile, BOM CSV and the PDF document.
//!
//! The frontend sends a `ReportInput` (entities with their dynamic props,
//! cables with the measured length, roads, the last simulation and the saved
//! scenarios); everything that is computed — counts, meters, costs, totals —
//! is computed here. Prices are symbolic (`Q_LIST.md` Q20): a catalog price
//! per network kind, overridden by the dynamic prop `price`; cables cost
//! `length × costPerMeter`; labor is a fixed amount per element plus a cost
//! per metre that depends on the route.

pub mod pdf;

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::network::export::row;
use crate::network::graph::{num, Props};
use crate::network::metrics::TerrainGrid;
use crate::network::PathResult;
use crate::project_file::Scenario;
use pdf::Pdf;

/// Symbolic catalog: kind, pt-PT label, unit price (€).
const ELEMENT_CATALOG: [(&str, &str, f64); 8] = [
    ("olt", "OLT", 3500.0),
    ("splitter", "Splitter ótico", 40.0),
    ("onu", "ONU", 60.0),
    ("antenna", "Antena", 2500.0),
    ("router", "Router", 180.0),
    ("switch", "Switch", 250.0),
    ("pole", "Poste", 150.0),
    ("box", "Caixa de distribuição", 80.0),
];
const BUILDING_KINDS: [&str; 4] = ["house", "building", "lot", "customGlb"];
const CABLE_TYPES: [(&str, &str); 3] = [
    ("fiber", "Cabo de fibra"),
    ("copper", "Cabo de cobre"),
    ("coax", "Cabo coaxial"),
];
/// Labor (€): per installed element, and per metre of cable by route.
const INSTALL_PER_ELEMENT: f64 = 30.0;
const LABOR_PER_M: [(&str, &str, f64); 3] = [
    (
        "underground",
        "Mão de obra — vala para cabo subterrâneo",
        12.0,
    ),
    ("aerial", "Mão de obra — cabo aéreo", 5.0),
    ("direct", "Mão de obra — ligação direta", 2.0),
];
const PROFILE_SAMPLES: usize = 100;
/// Scenario metrics written by `tools/report.ts`: key, pt-PT header, decimals.
const SCENARIO_METRICS: [(&str, &str, usize); 7] = [
    ("buildings", "Edifícios", 0),
    ("elements", "Elementos de rede", 0),
    ("cableM", "Cabo (m)", 1),
    ("cost", "Custo da BOM (€)", 2),
    ("latencyMs", "Latência (ms)", 3),
    ("bandwidthMbps", "Débito (Mbps)", 1),
    ("attenuationDb", "Atenuação (dB)", 2),
];
/// Scenarios per comparison table in the PDF (columns side by side).
const SCENARIOS_PER_TABLE: usize = 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntity {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub props: Props,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCable {
    pub cable_type: String,
    pub route: String,
    /// Measured length (m).
    pub length: f64,
    #[serde(default)]
    pub props: Props,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRoad {
    pub length: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportInput {
    pub name: String,
    /// Display date (the frontend formats it in pt-PT).
    pub date: String,
    pub terrain_size: f64,
    pub entities: Vec<ReportEntity>,
    pub cables: Vec<ReportCable>,
    #[serde(default)]
    pub roads: Vec<ReportRoad>,
    #[serde(default)]
    pub simulation: Option<PathResult>,
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CableMeters {
    pub cable_type: String,
    pub count: usize,
    pub meters: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub area_m2: f64,
    pub buildings: usize,
    pub elements: usize,
    pub markers: usize,
    pub roads: usize,
    pub road_length_m: f64,
    pub cables: Vec<CableMeters>,
    pub cable_length_m: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BomRow {
    pub item: String,
    pub quantity: f64,
    /// `un` or `m`.
    pub unit: String,
    pub unit_cost: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bom {
    pub rows: Vec<BomRow>,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportData {
    pub stats: Stats,
    pub bom: Bom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point2 {
    pub x: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct ProfilePoint {
    /// Distance from the start along the ground (m).
    pub distance: f64,
    pub height: f64,
}

fn validate(input: &ReportInput) -> Result<(), AppError> {
    let bad = |what: &str| Err(AppError::InvalidReport(what.to_string()));
    if !(input.terrain_size.is_finite() && input.terrain_size >= 0.0) {
        return bad("tamanho do terreno inválido");
    }
    if input
        .cables
        .iter()
        .any(|c| !(c.length.is_finite() && c.length >= 0.0))
        || input
            .roads
            .iter()
            .any(|r| !(r.length.is_finite() && r.length >= 0.0))
    {
        return bad("comprimento negativo ou inválido");
    }
    let negative = |p: &Props, k: &str| num(p, k).is_some_and(|v| !(v.is_finite() && v >= 0.0));
    if input.entities.iter().any(|e| negative(&e.props, "price"))
        || input
            .cables
            .iter()
            .any(|c| negative(&c.props, "costPerMeter"))
    {
        return bad("preço negativo");
    }
    Ok(())
}

pub fn stats(input: &ReportInput) -> Stats {
    let cables = CABLE_TYPES
        .iter()
        .map(|(t, _)| {
            let of_type = input.cables.iter().filter(|c| c.cable_type == *t);
            CableMeters {
                cable_type: t.to_string(),
                count: of_type.clone().count(),
                meters: of_type.map(|c| c.length).sum(),
            }
        })
        .collect::<Vec<_>>();
    Stats {
        area_m2: input.terrain_size * input.terrain_size,
        buildings: input
            .entities
            .iter()
            .filter(|e| BUILDING_KINDS.contains(&e.kind.as_str()))
            .count(),
        elements: input
            .entities
            .iter()
            .filter(|e| ELEMENT_CATALOG.iter().any(|(k, _, _)| *k == e.kind))
            .count(),
        markers: input.entities.iter().filter(|e| e.kind == "marker").count(),
        roads: input.roads.len(),
        road_length_m: input.roads.iter().map(|r| r.length).sum(),
        cable_length_m: cables.iter().map(|c| c.meters).sum(),
        cables,
    }
}

pub fn bom(input: &ReportInput) -> Bom {
    let mut rows = Vec::new();
    // Network elements, grouped by (kind, unit price).
    for (kind, label, catalog) in ELEMENT_CATALOG {
        let mut groups: Vec<(f64, f64)> = Vec::new(); // (price, quantity)
        for e in input.entities.iter().filter(|e| e.kind == kind) {
            let price = num(&e.props, "price").unwrap_or(catalog);
            match groups.iter_mut().find(|(p, _)| *p == price) {
                Some(g) => g.1 += 1.0,
                None => groups.push((price, 1.0)),
            }
        }
        for (price, quantity) in groups {
            rows.push(BomRow {
                item: label.into(),
                quantity,
                unit: "un".into(),
                unit_cost: price,
                total: price * quantity,
            });
        }
    }
    // Cables, grouped by (type, cost per metre).
    for (t, label) in CABLE_TYPES {
        let mut groups: Vec<(f64, f64)> = Vec::new(); // (€/m, metres)
        for c in input.cables.iter().filter(|c| c.cable_type == t) {
            let cpm = num(&c.props, "costPerMeter").unwrap_or(0.0);
            match groups.iter_mut().find(|(p, _)| *p == cpm) {
                Some(g) => g.1 += c.length,
                None => groups.push((cpm, c.length)),
            }
        }
        for (cpm, meters) in groups {
            rows.push(BomRow {
                item: label.into(),
                quantity: meters,
                unit: "m".into(),
                unit_cost: cpm,
                total: cpm * meters,
            });
        }
    }
    // Symbolic labor.
    let elements = input
        .entities
        .iter()
        .filter(|e| ELEMENT_CATALOG.iter().any(|(k, _, _)| *k == e.kind))
        .count();
    if elements > 0 {
        let q = elements as f64;
        rows.push(BomRow {
            item: "Mão de obra — instalação de elementos".into(),
            quantity: q,
            unit: "un".into(),
            unit_cost: INSTALL_PER_ELEMENT,
            total: q * INSTALL_PER_ELEMENT,
        });
    }
    for (route, label, per_m) in LABOR_PER_M {
        let meters: f64 = input
            .cables
            .iter()
            .filter(|c| c.route == route)
            .map(|c| c.length)
            .sum();
        if meters > 0.0 {
            rows.push(BomRow {
                item: label.into(),
                quantity: meters,
                unit: "m".into(),
                unit_cost: per_m,
                total: meters * per_m,
            });
        }
    }
    let total = rows.iter().map(|r| r.total).sum();
    Bom { rows, total }
}

pub fn project_report(input: &ReportInput) -> Result<ReportData, AppError> {
    validate(input)?;
    Ok(ReportData {
        stats: stats(input),
        bom: bom(input),
    })
}

/// Heights along the straight line `from → to` (`PROFILE_SAMPLES + 1` points).
pub fn terrain_profile(
    terrain: &TerrainGrid,
    from: Point2,
    to: Point2,
) -> Result<Vec<ProfilePoint>, AppError> {
    terrain.validate()?;
    let length = (to.x - from.x).hypot(to.z - from.z);
    Ok((0..=PROFILE_SAMPLES)
        .map(|i| {
            let t = i as f64 / PROFILE_SAMPLES as f64;
            ProfilePoint {
                distance: t * length,
                height: terrain.height(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t),
            }
        })
        .collect())
}

/// pt-PT number: `1234.5` → `1234,50`. `+ 0.0` turns the `-0.0` of an empty
/// `f64` sum into `0.0` (it printed «-0,0 m»).
fn n2(v: f64) -> String {
    fixed(v, 2)
}

fn n1(v: f64) -> String {
    fixed(v, 1)
}

fn fixed(v: f64, decimals: usize) -> String {
    format!("{:.*}", decimals, v + 0.0).replace('.', ",")
}

pub fn bom_csv(bom: &Bom) -> String {
    let mut out = row(&[
        "Elemento",
        "Quantidade",
        "Unidade",
        "Custo unitário (€)",
        "Total (€)",
    ]);
    for r in &bom.rows {
        out += &row(&[
            &r.item,
            &format!("{:.2}", r.quantity),
            &r.unit,
            &format!("{:.2}", r.unit_cost),
            &format!("{:.2}", r.total),
        ]);
    }
    out += &row(&["Total do projeto", "", "", "", &format!("{:.2}", bom.total)]);
    out
}

fn cable_label(t: &str) -> &str {
    CABLE_TYPES
        .iter()
        .find(|(k, _)| *k == t)
        .map(|(_, l)| *l)
        .unwrap_or(t)
}

/// The report document (cover → stats → BOM → simulation → scenarios → appendix).
pub fn report_pdf(input: &ReportInput, data: &ReportData, image: Option<Vec<u8>>) -> Vec<u8> {
    let mut pdf = Pdf::new();
    pdf.heading(&format!("Relatório — {}", input.name));
    pdf.paragraph(&format!("Terra_Map · {}", input.date));
    if let Some(jpeg) = image {
        pdf.image(jpeg);
    }

    let s = &data.stats;
    pdf.subheading("Estatísticas");
    let mut rows = vec![
        vec!["Área do terreno".into(), format!("{} m²", n1(s.area_m2))],
        vec!["Edifícios".into(), s.buildings.to_string()],
        vec!["Elementos de rede".into(), s.elements.to_string()],
        vec!["Marcadores".into(), s.markers.to_string()],
        vec![
            "Estradas".into(),
            format!("{} ({} m)", s.roads, n1(s.road_length_m)),
        ],
    ];
    for c in &s.cables {
        rows.push(vec![
            cable_label(&c.cable_type).into(),
            format!("{} cabos · {} m", c.count, n1(c.meters)),
        ]);
    }
    rows.push(vec![
        "Cabo no total".into(),
        format!("{} m", n1(s.cable_length_m)),
    ]);
    pdf.table(&["Métrica", "Valor"], &[0.55, 0.45], &rows);

    pdf.subheading("Lista de materiais (BOM)");
    let mut bom_rows: Vec<Vec<String>> = data
        .bom
        .rows
        .iter()
        .map(|r| {
            vec![
                r.item.clone(),
                format!("{} {}", n2(r.quantity), r.unit),
                format!("{} €", n2(r.unit_cost)),
                format!("{} €", n2(r.total)),
            ]
        })
        .collect();
    bom_rows.push(vec![
        "Total do projeto".into(),
        String::new(),
        String::new(),
        format!("{} €", n2(data.bom.total)),
    ]);
    pdf.table(
        &["Elemento", "Quantidade", "Custo unitário", "Total"],
        &[0.46, 0.18, 0.18, 0.18],
        &bom_rows,
    );
    pdf.paragraph(
        "Preços e mão de obra simbólicos (catálogo ou prop «price»; cabos pelo «costPerMeter»).",
    );

    pdf.subheading("Simulação de rede");
    match &input.simulation {
        Some(r) => {
            let m = &r.metrics;
            let mut rows = vec![
                vec!["Caminho".into(), r.nodes.join(" > ")],
                vec!["Comprimento".into(), format!("{} m", n1(m.length_m))],
                vec![
                    "Latência".into(),
                    format!("{} ms", format!("{:.3}", m.latency_ms).replace('.', ",")),
                ],
                vec![
                    "Débito (gargalo)".into(),
                    m.bandwidth_mbps
                        .map(|b| format!("{} Mbps", n1(b)))
                        .unwrap_or_else(|| "—".into()),
                ],
                vec!["Custo".into(), format!("{} €", n2(m.cost))],
                vec!["Atenuação".into(), format!("{} dB", n2(m.attenuation_db))],
            ];
            if let Some(lb) = &m.link_budget {
                rows.push(vec![
                    "Potência recebida".into(),
                    format!("{} dBm (folga {} dB)", n1(lb.prx_dbm), n1(lb.headroom_db)),
                ]);
            }
            pdf.table(&["Métrica", "Valor"], &[0.35, 0.65], &rows);
        }
        None => pdf.paragraph("Sem simulação calculada."),
    }

    if !input.scenarios.is_empty() {
        pdf.subheading("Cenários");
        // Rows = metrics (every key any scenario has, known ones first), columns = scenarios.
        let mut keys: Vec<&str> = SCENARIO_METRICS.iter().map(|(k, _, _)| *k).collect();
        for m in input.scenarios.iter().flat_map(|sc| &sc.metrics) {
            if !keys.contains(&m.key.as_str()) {
                keys.push(&m.key);
            }
        }
        keys.retain(|k| {
            input
                .scenarios
                .iter()
                .any(|sc| sc.metrics.iter().any(|m| m.key == *k))
        });
        for chunk in input.scenarios.chunks(SCENARIOS_PER_TABLE) {
            let rows: Vec<Vec<String>> = keys
                .iter()
                .map(|key| {
                    let (label, decimals) = SCENARIO_METRICS
                        .iter()
                        .find(|(k, _, _)| k == key)
                        .map(|(_, l, d)| (*l, *d))
                        .unwrap_or((key, 2));
                    let mut row = vec![label.to_string()];
                    for sc in chunk {
                        let v = sc.metrics.iter().find(|m| m.key == *key).map(|m| m.value);
                        row.push(v.map_or_else(|| "—".into(), |v| fixed(v, decimals)));
                    }
                    row
                })
                .collect();
            let headers: Vec<&str> = std::iter::once("Métrica")
                .chain(chunk.iter().map(|sc| sc.name.as_str()))
                .collect();
            let w = 0.7 / chunk.len() as f64;
            let widths: Vec<f64> = std::iter::once(0.3)
                .chain(std::iter::repeat_n(w, chunk.len()))
                .collect();
            pdf.table(&headers, &widths, &rows);
        }
    }

    let with_props: Vec<&ReportEntity> = input
        .entities
        .iter()
        .filter(|e| !e.props.is_empty())
        .collect();
    if !with_props.is_empty() {
        pdf.subheading("Apêndice — propriedades dinâmicas");
        let rows: Vec<Vec<String>> = with_props
            .iter()
            .map(|e| {
                let mut props: Vec<String> =
                    e.props.iter().map(|(k, v)| format!("{k}={v}")).collect();
                props.sort(); // HashMap order is random; the PDF must not change between runs
                let props = props.join(", ");
                vec![e.id.clone(), e.kind.clone(), props]
            })
            .collect();
        pdf.table(&["ID", "Tipo", "Propriedades"], &[0.15, 0.15, 0.7], &rows);
    }
    pdf.finish()
}

fn save_with_dialog(
    app: &AppHandle,
    filter: &str,
    ext: &str,
    name: &str,
    bytes: &[u8],
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(filter, &[ext])
        .set_file_name(name)
        .blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file
        .as_path()
        .ok_or(AppError::InvalidFilePath)?
        .to_path_buf();
    write_file(&path, bytes)?;
    Ok(Some(
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    ))
}

/// Unit-testable half of the save dialogs.
pub fn write_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    std::fs::write(path, bytes)?;
    Ok(())
}

/// PDF report via a native save dialog. `Ok(None)` = cancelled.
pub fn export_pdf(
    app: &AppHandle,
    input: &ReportInput,
    image: Option<Vec<u8>>,
) -> Result<Option<String>, AppError> {
    let data = project_report(input)?;
    let image = image.filter(|bytes| pdf::jpeg_size(bytes).is_some()); // hostile input: ignore a bad image
    save_with_dialog(
        app,
        "Documento PDF",
        "pdf",
        "relatorio.pdf",
        &report_pdf(input, &data, image),
    )
}

/// BOM as CSV via a native save dialog. `Ok(None)` = cancelled.
pub fn export_bom_csv(app: &AppHandle, input: &ReportInput) -> Result<Option<String>, AppError> {
    let data = project_report(input)?;
    save_with_dialog(
        app,
        "Folha de cálculo CSV",
        "csv",
        "lista-de-materiais.csv",
        bom_csv(&data.bom).as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn props(v: serde_json::Value) -> Props {
        serde_json::from_value(v).unwrap_or_default()
    }

    fn entity(id: &str, kind: &str, p: serde_json::Value) -> ReportEntity {
        ReportEntity {
            id: id.into(),
            kind: kind.into(),
            props: props(p),
        }
    }

    fn cable(t: &str, route: &str, length: f64, cpm: f64) -> ReportCable {
        ReportCable {
            cable_type: t.into(),
            route: route.into(),
            length,
            props: props(json!({ "costPerMeter": cpm })),
        }
    }

    /// FTTH: OLT → splitter → 2 ONUs, a house, a marker, a road.
    fn ftth() -> ReportInput {
        ReportInput {
            name: "Bairro Norte".into(),
            date: "20/10/2026".into(),
            terrain_size: 200.0,
            entities: vec![
                entity("bld_1", "olt", json!({ "power": 5 })),
                entity("bld_2", "splitter", json!({})),
                entity("bld_3", "onu", json!({})),
                entity("bld_4", "onu", json!({ "price": 75 })),
                entity("bld_5", "house", json!({})),
                entity("bld_6", "marker", json!({})),
            ],
            cables: vec![
                cable("fiber", "underground", 100.0, 1.2),
                cable("fiber", "underground", 50.0, 1.2),
                cable("fiber", "aerial", 25.0, 1.2),
            ],
            roads: vec![ReportRoad { length: 40.0 }],
            simulation: None,
            scenarios: vec![],
        }
    }

    #[test]
    fn stats_count_everything() {
        let s = stats(&ftth());
        assert_eq!(s.area_m2, 40_000.0);
        assert_eq!((s.buildings, s.elements, s.markers, s.roads), (1, 4, 1, 1));
        assert_eq!(
            s.cables[0],
            CableMeters {
                cable_type: "fiber".into(),
                count: 3,
                meters: 175.0
            }
        );
        assert_eq!(s.cable_length_m, 175.0);
    }

    #[test]
    fn bom_prices_cables_and_labor() {
        let b = bom(&ftth());
        let get = |item: &str| b.rows.iter().filter(|r| r.item == item).collect::<Vec<_>>();
        assert_eq!(get("OLT")[0].total, 3500.0);
        // Two ONUs at different prices → two rows.
        let onus = get("ONU");
        assert_eq!(onus.len(), 2);
        assert_eq!(onus.iter().map(|r| r.total).sum::<f64>(), 60.0 + 75.0);
        // Fiber: 175 m × 1.2 €/m.
        assert!((get("Cabo de fibra")[0].total - 210.0).abs() < 1e-9);
        // Labor: 4 elements × 30, 150 m underground × 12, 25 m aerial × 5.
        assert_eq!(get("Mão de obra — instalação de elementos")[0].total, 120.0);
        assert_eq!(
            get("Mão de obra — vala para cabo subterrâneo")[0].total,
            1800.0
        );
        assert_eq!(get("Mão de obra — cabo aéreo")[0].total, 125.0);
        let expected = 3500.0 + 40.0 + 60.0 + 75.0 + 210.0 + 120.0 + 1800.0 + 125.0;
        assert!((b.total - expected).abs() < 1e-9, "{}", b.total);
        // Houses and markers are not network materials.
        assert!(b.rows.iter().all(|r| !r.item.contains("Casa")));
    }

    #[test]
    fn numbers_print_in_pt_and_never_negative_zero() {
        let empty: f64 = Vec::<f64>::new().into_iter().sum();
        assert_eq!(n1(empty), "0,0");
        assert_eq!(n2(1234.5), "1234,50");
    }

    #[test]
    fn report_rejects_negative_numbers() {
        let mut input = ftth();
        input.cables[0].length = -1.0;
        assert!(project_report(&input).is_err());
        let mut input = ftth();
        input.entities[0].props.insert("price".into(), json!(-5));
        assert!(project_report(&input).is_err());
    }

    #[test]
    fn profile_samples_the_line() {
        let terrain = TerrainGrid {
            size: 2.0,
            resolution: 2,
            heights: vec![0.0, 2.0, 4.0, 6.0],
        };
        let p = terrain_profile(
            &terrain,
            Point2 { x: -1.0, z: -1.0 },
            Point2 { x: 1.0, z: 1.0 },
        )
        .unwrap();
        assert_eq!(p.len(), PROFILE_SAMPLES + 1);
        assert_eq!(p[0].height, 0.0);
        assert_eq!(p.last().unwrap().height, 6.0);
        assert!((p.last().unwrap().distance - 8f64.sqrt()).abs() < 1e-9);
        assert!((p[PROFILE_SAMPLES / 2].height - 3.0).abs() < 1e-9);
    }

    #[test]
    fn bom_csv_has_rows_and_total() {
        let csv = bom_csv(&bom(&ftth()));
        assert!(csv.starts_with("Elemento,Quantidade,Unidade,Custo unitário (€),Total (€)\r\n"));
        assert!(csv.contains("OLT,1.00,un,3500.00,3500.00\r\n"));
        assert!(csv.trim_end().ends_with("Total do projeto,,,,5930.00"));
    }

    #[test]
    fn pdf_contains_bom_total_and_simulation() {
        let mut input = ftth();
        let metric = |key: &str, value: f64| crate::project_file::ScenarioMetric {
            key: key.into(),
            value,
        };
        input.scenarios = vec![
            Scenario {
                name: "Base".into(),
                metrics: vec![metric("cost", 5930.0), metric("buildings", 1.0)],
            },
            Scenario {
                name: "Alternativa".into(),
                metrics: vec![metric("cost", 4100.5), metric("futureMetric", 7.0)],
            },
        ];
        let data = project_report(&input).unwrap();
        let bytes = report_pdf(&input, &data, Some(pdf::tests::tiny_jpeg()));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("(5930,00 \u{FFFD})")); // € is the WinAnsi byte 0x80
        assert!(text.contains("(Sem simula"));
        assert!(text.contains("(Base)") && text.contains("(Alternativa)"));
        // Known keys get their pt-PT header and decimals; unknown keys print as is.
        assert!(text.contains("(Custo da BOM ") && text.contains("(4100,50)"));
        assert!(text.contains("(Edif") && text.contains("(1)"));
        assert!(text.contains("(futureMetric)") && text.contains("(7,00)"));
        assert!(text.contains("/DCTDecode"));

        // With a real Dijkstra result, the path and its metrics are printed.
        let network: crate::network::graph::NetworkInput = serde_json::from_value(json!({
            "nodes": [{ "id": "bld_1", "props": { "power": 5 } }, { "id": "bld_3", "props": { "sensitivity": -28 } }],
            "edges": [{ "id": "cab_1", "fromId": "bld_1", "toId": "bld_3", "cableType": "fiber", "length": 100.0 }]
        }))
        .unwrap();
        input.simulation = crate::network::shortest_path(
            network,
            "bld_1",
            "bld_3",
            crate::network::graph::Weight::Distance,
        )
        .unwrap();
        let text = String::from_utf8_lossy(&report_pdf(&input, &data, None)).to_string();
        assert!(text.contains("(bld_1 > bld_3)"));
        assert!(text.contains("(100,0 m)"));
        assert!(text.contains("Pot"), "link budget row");

        // Manual check in a real viewer: REPORT_PDF_OUT=/tmp/x.pdf cargo test
        if let Ok(out) = std::env::var("REPORT_PDF_OUT") {
            let many: Vec<ReportEntity> = (0..60)
                .map(|i| entity(&format!("bld_{}", i + 10), "onu", json!({ "price": i })))
                .collect();
            input.entities.extend(many);
            let data = project_report(&input).unwrap();
            write_file(Path::new(&out), &report_pdf(&input, &data, None)).unwrap();
        }
    }
}
