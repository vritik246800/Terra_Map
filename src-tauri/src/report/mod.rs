//! Project report (Fase 12, `FEATURE_RELATORIOS.md`): statistics, bill of
//! materials, terrain profile, BOM CSV and the PDF document.
//!
//! The frontend sends a `ReportInput` (entities with their dynamic props,
//! cables with the measured length, roads, the last simulation, the saved
//! scenarios and the UI language); everything that is computed — counts,
//! meters, costs, totals — is computed here. Prices are symbolic
//! (`Q_LIST.md` Q20): a catalog price per network kind, overridden by the
//! dynamic prop `price`; cables cost `length × costPerMeter`; labor is a fixed
//! amount per element plus a cost per metre that depends on the route. Fase 13:
//! every text and number follows `lang` (pt-PT by default, `Q_LIST.md` Q24).

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

/// Symbolic catalog: kind, unit price (€). Labels: `Texts::elements`.
const ELEMENT_CATALOG: [(&str, f64); 8] = [
    ("olt", 3500.0),
    ("splitter", 40.0),
    ("onu", 60.0),
    ("antenna", 2500.0),
    ("router", 180.0),
    ("switch", 250.0),
    ("pole", 150.0),
    ("box", 80.0),
];
const BUILDING_KINDS: [&str; 4] = ["house", "building", "lot", "customGlb"];
/// Labels: `Texts::cables`.
const CABLE_TYPES: [&str; 3] = ["fiber", "copper", "coax"];
/// Labor (€): per installed element, and per metre of cable by route
/// (labels: `Texts::labor_routes`).
const INSTALL_PER_ELEMENT: f64 = 30.0;
const LABOR_PER_M: [(&str, f64); 3] = [("underground", 12.0), ("aerial", 5.0), ("direct", 2.0)];
const PROFILE_SAMPLES: usize = 100;
/// Scenario metrics written by `tools/report.ts`: key, decimals (labels:
/// `Texts::scenario_metrics`).
const SCENARIO_METRICS: [(&str, usize); 7] = [
    ("buildings", 0),
    ("elements", 0),
    ("cableM", 1),
    ("cost", 2),
    ("latencyMs", 3),
    ("bandwidthMbps", 1),
    ("attenuationDb", 2),
];
/// Scenarios per comparison table in the PDF (columns side by side).
const SCENARIOS_PER_TABLE: usize = 4;

/// Report language (Fase 13): the UI language, pt-PT by default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Pt,
    En,
}

/// Every text the report writes, in one language. The arrays follow the
/// order of `ELEMENT_CATALOG`, `CABLE_TYPES`, `LABOR_PER_M` and `SCENARIO_METRICS`.
struct Texts {
    elements: [&'static str; 8],
    cables: [&'static str; 3],
    labor_install: &'static str,
    labor_routes: [&'static str; 3],
    scenario_metrics: [&'static str; 7],
    piece: &'static str,
    decimal: char,
    title: &'static str,
    stats: &'static str,
    metric: &'static str,
    value: &'static str,
    area: &'static str,
    buildings: &'static str,
    elements_row: &'static str,
    markers: &'static str,
    roads: &'static str,
    cables_word: &'static str,
    cable_total: &'static str,
    bom: &'static str,
    item: &'static str,
    quantity: &'static str,
    unit_cost: &'static str,
    total: &'static str,
    project_total: &'static str,
    prices_note: &'static str,
    simulation: &'static str,
    path: &'static str,
    length: &'static str,
    latency: &'static str,
    bandwidth: &'static str,
    cost: &'static str,
    attenuation: &'static str,
    received_power: &'static str,
    headroom: &'static str,
    no_simulation: &'static str,
    scenarios: &'static str,
    appendix: &'static str,
    kind: &'static str,
    properties: &'static str,
    csv_header: [&'static str; 5],
    pdf_filter: &'static str,
    pdf_file: &'static str,
    csv_filter: &'static str,
    csv_file: &'static str,
}

const PT: Texts = Texts {
    elements: [
        "OLT",
        "Splitter ótico",
        "ONU",
        "Antena",
        "Router",
        "Switch",
        "Poste",
        "Caixa de distribuição",
    ],
    cables: ["Cabo de fibra", "Cabo de cobre", "Cabo coaxial"],
    labor_install: "Mão de obra — instalação de elementos",
    labor_routes: [
        "Mão de obra — vala para cabo subterrâneo",
        "Mão de obra — cabo aéreo",
        "Mão de obra — ligação direta",
    ],
    scenario_metrics: [
        "Edifícios",
        "Elementos de rede",
        "Cabo (m)",
        "Custo da BOM (€)",
        "Latência (ms)",
        "Débito (Mbps)",
        "Atenuação (dB)",
    ],
    piece: "un",
    decimal: ',',
    title: "Relatório",
    stats: "Estatísticas",
    metric: "Métrica",
    value: "Valor",
    area: "Área do terreno",
    buildings: "Edifícios",
    elements_row: "Elementos de rede",
    markers: "Marcadores",
    roads: "Estradas",
    cables_word: "cabos",
    cable_total: "Cabo no total",
    bom: "Lista de materiais (BOM)",
    item: "Elemento",
    quantity: "Quantidade",
    unit_cost: "Custo unitário",
    total: "Total",
    project_total: "Total do projeto",
    prices_note:
        "Preços e mão de obra simbólicos (catálogo ou prop «price»; cabos pelo «costPerMeter»).",
    simulation: "Simulação de rede",
    path: "Caminho",
    length: "Comprimento",
    latency: "Latência",
    bandwidth: "Débito (gargalo)",
    cost: "Custo",
    attenuation: "Atenuação",
    received_power: "Potência recebida",
    headroom: "folga",
    no_simulation: "Sem simulação calculada.",
    scenarios: "Cenários",
    appendix: "Apêndice — propriedades dinâmicas",
    kind: "Tipo",
    properties: "Propriedades",
    csv_header: [
        "Elemento",
        "Quantidade",
        "Unidade",
        "Custo unitário (€)",
        "Total (€)",
    ],
    pdf_filter: "Documento PDF",
    pdf_file: "relatorio.pdf",
    csv_filter: "Folha de cálculo CSV",
    csv_file: "lista-de-materiais.csv",
};

const EN: Texts = Texts {
    elements: [
        "OLT",
        "Optical splitter",
        "ONU",
        "Antenna",
        "Router",
        "Switch",
        "Pole",
        "Distribution box",
    ],
    cables: ["Fiber cable", "Copper cable", "Coaxial cable"],
    labor_install: "Labor — element installation",
    labor_routes: [
        "Labor — trench for underground cable",
        "Labor — aerial cable",
        "Labor — direct link",
    ],
    scenario_metrics: [
        "Buildings",
        "Network elements",
        "Cable (m)",
        "BOM cost (€)",
        "Latency (ms)",
        "Throughput (Mbps)",
        "Attenuation (dB)",
    ],
    piece: "pcs",
    decimal: '.',
    title: "Report",
    stats: "Statistics",
    metric: "Metric",
    value: "Value",
    area: "Terrain area",
    buildings: "Buildings",
    elements_row: "Network elements",
    markers: "Markers",
    roads: "Roads",
    cables_word: "cables",
    cable_total: "Total cable",
    bom: "Bill of materials (BOM)",
    item: "Item",
    quantity: "Quantity",
    unit_cost: "Unit cost",
    total: "Total",
    project_total: "Project total",
    prices_note:
        "Symbolic prices and labor (catalog or the “price” prop; cables by “costPerMeter”).",
    simulation: "Network simulation",
    path: "Path",
    length: "Length",
    latency: "Latency",
    bandwidth: "Throughput (bottleneck)",
    cost: "Cost",
    attenuation: "Attenuation",
    received_power: "Received power",
    headroom: "margin",
    no_simulation: "No simulation computed.",
    scenarios: "Scenarios",
    appendix: "Appendix — dynamic properties",
    kind: "Kind",
    properties: "Properties",
    csv_header: ["Item", "Quantity", "Unit", "Unit cost (€)", "Total (€)"],
    pdf_filter: "PDF document",
    pdf_file: "report.pdf",
    csv_filter: "CSV spreadsheet",
    csv_file: "bill-of-materials.csv",
};

fn texts(lang: Lang) -> &'static Texts {
    match lang {
        Lang::Pt => &PT,
        Lang::En => &EN,
    }
}

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
    /// Display date (the frontend formats it in the UI language).
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
    /// Fase 13: language of the texts and numbers (absent = pt-PT).
    #[serde(default)]
    pub lang: Lang,
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
    /// `m`, or pieces in the report language (`un` / `pcs`).
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

fn is_element(kind: &str) -> bool {
    ELEMENT_CATALOG.iter().any(|(k, _)| *k == kind)
}

pub fn stats(input: &ReportInput) -> Stats {
    let cables = CABLE_TYPES
        .iter()
        .map(|t| {
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
            .filter(|e| is_element(&e.kind))
            .count(),
        markers: input.entities.iter().filter(|e| e.kind == "marker").count(),
        roads: input.roads.len(),
        road_length_m: input.roads.iter().map(|r| r.length).sum(),
        cable_length_m: cables.iter().map(|c| c.meters).sum(),
        cables,
    }
}

/// Adds `amount` to the group with the same unit price (rows with equal prices merge).
fn group(groups: &mut Vec<(f64, f64)>, price: f64, amount: f64) {
    match groups.iter_mut().find(|(p, _)| *p == price) {
        Some(g) => g.1 += amount,
        None => groups.push((price, amount)),
    }
}

pub fn bom(input: &ReportInput) -> Bom {
    let t = texts(input.lang);
    let mut rows = Vec::new();
    let mut push = |item: &str, quantity: f64, unit: &str, unit_cost: f64| {
        rows.push(BomRow {
            item: item.into(),
            quantity,
            unit: unit.into(),
            unit_cost,
            total: quantity * unit_cost,
        })
    };
    // Network elements, grouped by (kind, unit price).
    for ((kind, catalog), label) in ELEMENT_CATALOG.iter().zip(t.elements) {
        let mut groups = Vec::new(); // (price, quantity)
        for e in input.entities.iter().filter(|e| e.kind == *kind) {
            group(&mut groups, num(&e.props, "price").unwrap_or(*catalog), 1.0);
        }
        for (price, quantity) in groups {
            push(label, quantity, t.piece, price);
        }
    }
    // Cables, grouped by (type, cost per metre).
    for (kind, label) in CABLE_TYPES.iter().zip(t.cables) {
        let mut groups = Vec::new(); // (€/m, metres)
        for c in input.cables.iter().filter(|c| c.cable_type == *kind) {
            group(
                &mut groups,
                num(&c.props, "costPerMeter").unwrap_or(0.0),
                c.length,
            );
        }
        for (cpm, meters) in groups {
            push(label, meters, "m", cpm);
        }
    }
    // Symbolic labor.
    let elements = input
        .entities
        .iter()
        .filter(|e| is_element(&e.kind))
        .count();
    if elements > 0 {
        push(
            t.labor_install,
            elements as f64,
            t.piece,
            INSTALL_PER_ELEMENT,
        );
    }
    for ((route, per_m), label) in LABOR_PER_M.iter().zip(t.labor_routes) {
        let meters: f64 = input
            .cables
            .iter()
            .filter(|c| c.route == *route)
            .map(|c| c.length)
            .sum();
        if meters > 0.0 {
            push(label, meters, "m", *per_m);
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

/// `1234.5` → `1234,50` (pt) / `1234.50` (en). `+ 0.0` turns the `-0.0` of an
/// empty `f64` sum into `0.0` (it printed «-0,0 m» — `ERRORS.md` E36).
fn fixed(v: f64, decimals: usize, t: &Texts) -> String {
    format!("{:.*}", decimals, v + 0.0).replace('.', &t.decimal.to_string())
}

/// CSV of the BOM — dot decimals in both languages (spreadsheets).
pub fn bom_csv(bom: &Bom, lang: Lang) -> String {
    let t = texts(lang);
    let mut out = row(&t.csv_header);
    for r in &bom.rows {
        out += &row(&[
            &r.item,
            &format!("{:.2}", r.quantity),
            &r.unit,
            &format!("{:.2}", r.unit_cost),
            &format!("{:.2}", r.total),
        ]);
    }
    out += &row(&[t.project_total, "", "", "", &format!("{:.2}", bom.total)]);
    out
}

/// The report document (cover → stats → BOM → simulation → scenarios → appendix).
pub fn report_pdf(input: &ReportInput, data: &ReportData, image: Option<Vec<u8>>) -> Vec<u8> {
    let t = texts(input.lang);
    let n = |v: f64, decimals: usize| fixed(v, decimals, t);
    let mut pdf = Pdf::new();
    pdf.heading(&format!("{} — {}", t.title, input.name));
    pdf.paragraph(&format!("Terra_Map · {}", input.date));
    if let Some(jpeg) = image {
        pdf.image(jpeg);
    }

    let s = &data.stats;
    pdf.subheading(t.stats);
    let mut rows = vec![
        vec![t.area.into(), format!("{} m²", n(s.area_m2, 1))],
        vec![t.buildings.into(), s.buildings.to_string()],
        vec![t.elements_row.into(), s.elements.to_string()],
        vec![t.markers.into(), s.markers.to_string()],
        vec![
            t.roads.into(),
            format!("{} ({} m)", s.roads, n(s.road_length_m, 1)),
        ],
    ];
    for (c, label) in s.cables.iter().zip(t.cables) {
        rows.push(vec![
            label.into(),
            format!("{} {} · {} m", c.count, t.cables_word, n(c.meters, 1)),
        ]);
    }
    rows.push(vec![
        t.cable_total.into(),
        format!("{} m", n(s.cable_length_m, 1)),
    ]);
    pdf.table(&[t.metric, t.value], &[0.55, 0.45], &rows);

    pdf.subheading(t.bom);
    let mut bom_rows: Vec<Vec<String>> = data
        .bom
        .rows
        .iter()
        .map(|r| {
            vec![
                r.item.clone(),
                format!("{} {}", n(r.quantity, 2), r.unit),
                format!("{} €", n(r.unit_cost, 2)),
                format!("{} €", n(r.total, 2)),
            ]
        })
        .collect();
    bom_rows.push(vec![
        t.project_total.into(),
        String::new(),
        String::new(),
        format!("{} €", n(data.bom.total, 2)),
    ]);
    pdf.table(
        &[t.item, t.quantity, t.unit_cost, t.total],
        &[0.46, 0.18, 0.18, 0.18],
        &bom_rows,
    );
    pdf.paragraph(t.prices_note);

    pdf.subheading(t.simulation);
    match &input.simulation {
        Some(r) => {
            let m = &r.metrics;
            let mut rows = vec![
                vec![t.path.into(), r.nodes.join(" > ")],
                vec![t.length.into(), format!("{} m", n(m.length_m, 1))],
                vec![t.latency.into(), format!("{} ms", n(m.latency_ms, 3))],
                vec![
                    t.bandwidth.into(),
                    m.bandwidth_mbps
                        .map(|b| format!("{} Mbps", n(b, 1)))
                        .unwrap_or_else(|| "—".into()),
                ],
                vec![t.cost.into(), format!("{} €", n(m.cost, 2))],
                vec![
                    t.attenuation.into(),
                    format!("{} dB", n(m.attenuation_db, 2)),
                ],
            ];
            if let Some(lb) = &m.link_budget {
                rows.push(vec![
                    t.received_power.into(),
                    format!(
                        "{} dBm ({} {} dB)",
                        n(lb.prx_dbm, 1),
                        t.headroom,
                        n(lb.headroom_db, 1)
                    ),
                ]);
            }
            pdf.table(&[t.metric, t.value], &[0.35, 0.65], &rows);
        }
        None => pdf.paragraph(t.no_simulation),
    }

    if !input.scenarios.is_empty() {
        pdf.subheading(t.scenarios);
        // Rows = metrics (every key any scenario has, known ones first), columns = scenarios.
        let mut keys: Vec<&str> = SCENARIO_METRICS.iter().map(|(k, _)| *k).collect();
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
                        .zip(t.scenario_metrics)
                        .find(|((k, _), _)| k == key)
                        .map(|((_, d), l)| (l, *d))
                        .unwrap_or((key, 2));
                    let mut row = vec![label.to_string()];
                    for sc in chunk {
                        let v = sc.metrics.iter().find(|m| m.key == *key).map(|m| m.value);
                        row.push(v.map_or_else(|| "—".into(), |v| n(v, decimals)));
                    }
                    row
                })
                .collect();
            let headers: Vec<&str> = std::iter::once(t.metric)
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
        pdf.subheading(t.appendix);
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
        pdf.table(&["ID", t.kind, t.properties], &[0.15, 0.15, 0.7], &rows);
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
    let t = texts(input.lang);
    save_with_dialog(
        app,
        t.pdf_filter,
        "pdf",
        t.pdf_file,
        &report_pdf(input, &data, image),
    )
}

/// BOM as CSV via a native save dialog. `Ok(None)` = cancelled.
pub fn export_bom_csv(app: &AppHandle, input: &ReportInput) -> Result<Option<String>, AppError> {
    let data = project_report(input)?;
    let t = texts(input.lang);
    save_with_dialog(
        app,
        t.csv_filter,
        "csv",
        t.csv_file,
        bom_csv(&data.bom, input.lang).as_bytes(),
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
            lang: Lang::Pt,
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
    fn numbers_print_in_the_language_and_never_negative_zero() {
        let empty: f64 = Vec::<f64>::new().into_iter().sum();
        assert_eq!(fixed(empty, 1, &PT), "0,0");
        assert_eq!(fixed(1234.5, 2, &PT), "1234,50");
        assert_eq!(fixed(1234.5, 2, &EN), "1234.50");
    }

    /// Fase 13: `lang: "en"` translates the BOM, the CSV and the PDF; absent = pt-PT.
    #[test]
    fn english_report_texts() {
        let mut input = ftth();
        input.lang = serde_json::from_value(json!("en")).unwrap();
        let b = bom(&input);
        assert!(b
            .rows
            .iter()
            .any(|r| r.item == "Fiber cable" && r.unit == "m"));
        assert!(b.rows.iter().any(|r| r.item == "OLT" && r.unit == "pcs"));
        assert!(b
            .rows
            .iter()
            .any(|r| r.item == "Labor — trench for underground cable"));
        let csv = bom_csv(&b, input.lang);
        assert!(csv.starts_with("Item,Quantity,Unit,Unit cost (€),Total (€)\r\n"));
        assert!(csv.trim_end().ends_with("Project total,,,,5930.00"));
        let data = project_report(&input).unwrap();
        let text = String::from_utf8_lossy(&report_pdf(&input, &data, None)).to_string();
        assert!(text.contains("(Report \u{FFFD} Bairro Norte)")); // — is the WinAnsi byte 0x97
        assert!(text.contains("(Bill of materials \\(BOM\\))")); // parentheses are escaped
        assert!(text.contains("(5930.00 \u{FFFD})") && text.contains("(No simulation computed.)"));
        // Every language has a label for every catalog entry.
        for t in [&PT, &EN] {
            assert!(t.elements.iter().chain(&t.cables).all(|l| !l.is_empty()));
        }
        // Older inputs without `lang` are pt-PT.
        let old: ReportInput =
            serde_json::from_str(include_str!("../fixtures/frontend-report.json")).unwrap();
        assert_eq!(old.lang, Lang::Pt);
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

    /// Contract with the frontend: the `ReportInput` that `tools/report.ts`
    /// sent in the Fase 12 smoke test (OLT → splitter → ONU, a house, two
    /// underground fiber cables, the simulated path and one scenario).
    #[test]
    fn frontend_written_report_input_is_valid() {
        let input: ReportInput =
            serde_json::from_str(include_str!("../fixtures/frontend-report.json")).unwrap();
        let data = project_report(&input).unwrap();
        assert_eq!((data.stats.buildings, data.stats.elements), (1, 3));
        let meters: f64 = input.cables.iter().map(|c| c.length).sum();
        assert!(meters > 0.0 && (data.stats.cable_length_m - meters).abs() < 1e-9);
        // Catalog (OLT + splitter + ONU) + fiber at 1.2 €/m + labor (3 × 30 € + 12 €/m underground).
        let expected = 3500.0 + 40.0 + 60.0 + meters * 1.2 + 3.0 * 30.0 + meters * 12.0;
        assert!(
            (data.bom.total - expected).abs() < 1e-6,
            "{}",
            data.bom.total
        );
        let sim = input.simulation.as_ref().unwrap();
        assert_eq!(sim.nodes, ["bld_1", "bld_2", "bld_3"]);
        let elements = input.scenarios[0]
            .metrics
            .iter()
            .find(|m| m.key == "elements");
        assert_eq!(elements.map(|m| m.value), Some(3.0));

        let text = String::from_utf8_lossy(&report_pdf(&input, &data, None)).to_string();
        assert!(text.contains("(bld_1 > bld_2 > bld_3)"));
        assert!(text.contains(&format!("({} \u{FFFD})", fixed(expected, 2, &PT))));
        assert!(text.contains("(Cen") && text.contains("rio 2)"));

        // Manual check with the real snapshot:
        // FRONTEND_REPORT_IMAGE=<jpg> FRONTEND_REPORT_PDF=<pdf> cargo test frontend_written_report
        if let (Ok(image), Ok(out)) = (
            std::env::var("FRONTEND_REPORT_IMAGE"),
            std::env::var("FRONTEND_REPORT_PDF"),
        ) {
            let jpeg = std::fs::read(image).unwrap();
            assert!(pdf::jpeg_size(&jpeg).is_some());
            write_file(Path::new(&out), &report_pdf(&input, &data, Some(jpeg))).unwrap();
        }
    }

    #[test]
    fn bom_csv_has_rows_and_total() {
        let csv = bom_csv(&bom(&ftth()), Lang::Pt);
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
