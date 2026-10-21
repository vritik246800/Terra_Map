//! Minimal PDF writer for the project report (Fase 12, `Q_LIST.md` Q19).
//!
//! No dependency: A4 pages, the standard Helvetica / Helvetica-Bold fonts in
//! WinAnsiEncoding (covers pt-PT accents and `€`), headings, paragraphs,
//! tables with automatic page breaks and one embedded JPEG (DCTDecode — the
//! browser already produces it). Text widths are approximated (Helvetica ≈
//! 0.52 em per glyph), enough to truncate table cells.

const PAGE_W: f64 = 595.0;
const PAGE_H: f64 = 842.0;
const MARGIN: f64 = 50.0;
const CONTENT_W: f64 = PAGE_W - 2.0 * MARGIN;
const GLYPH_EM: f64 = 0.52;

/// Encodes text to WinAnsi (cp1252) and escapes it for a PDF string.
pub fn pdf_string(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(b'(');
    for ch in text.chars() {
        let byte = match ch {
            '€' => 0x80,
            '…' => 0x85,
            '‘' => 0x91,
            '’' => 0x92,
            '“' => 0x93,
            '”' => 0x94,
            '•' => 0x95,
            '–' => 0x96,
            '—' => 0x97,
            '→' => b'>',
            c if (c as u32) < 0x80 || (0xA0..=0xFF).contains(&(c as u32)) => c as u32 as u8,
            _ => b'?',
        };
        if matches!(byte, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out.push(b')');
    out
}

/// Width/height of a baseline or progressive JPEG (SOF0/SOF1/SOF2 marker).
pub fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.get(0..2) != Some(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2;
    while i + 9 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        if matches!(marker, 0xC0..=0xC2) {
            let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
            return (w > 0 && h > 0).then_some((w, h));
        }
        i += 2 + len;
    }
    None
}

/// Cuts `text` so it fits `width` points at `size` (approximate metrics).
fn fit(text: &str, width: f64, size: f64) -> String {
    let max = ((width / (size * GLYPH_EM)).floor() as usize).max(1);
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

pub struct Pdf {
    /// Content streams, one per page.
    pages: Vec<Vec<u8>>,
    /// Current baseline from the top of the page.
    y: f64,
    jpeg: Option<(Vec<u8>, u32, u32)>,
}

impl Default for Pdf {
    fn default() -> Self {
        Self::new()
    }
}

impl Pdf {
    pub fn new() -> Self {
        Self {
            pages: vec![Vec::new()],
            y: MARGIN,
            jpeg: None,
        }
    }

    /// Appends operators to the current page (`new` always creates page 1).
    fn emit(&mut self, bytes: Vec<u8>) {
        if let Some(page) = self.pages.last_mut() {
            page.extend(bytes);
        }
    }

    /// Starts a new page when less than `height` points remain.
    fn ensure(&mut self, height: f64) {
        if self.y + height > PAGE_H - MARGIN {
            self.pages.push(Vec::new());
            self.y = MARGIN;
        }
    }

    fn text_at(&mut self, x: f64, y_top: f64, size: f64, bold: bool, text: &str) {
        let font = if bold { "F2" } else { "F1" };
        let mut op = format!("BT /{font} {size} Tf {x:.2} {:.2} Td ", PAGE_H - y_top).into_bytes();
        op.extend(pdf_string(text));
        op.extend_from_slice(b" Tj ET\n");
        self.emit(op);
    }

    pub fn heading(&mut self, text: &str) {
        self.ensure(30.0);
        self.y += 20.0;
        self.text_at(MARGIN, self.y, 18.0, true, text);
        self.y += 10.0;
    }

    pub fn subheading(&mut self, text: &str) {
        self.ensure(40.0);
        self.y += 22.0;
        self.text_at(MARGIN, self.y, 13.0, true, text);
        self.y += 6.0;
    }

    pub fn paragraph(&mut self, text: &str) {
        self.ensure(16.0);
        self.y += 14.0;
        self.text_at(MARGIN, self.y, 10.0, false, &fit(text, CONTENT_W, 10.0));
    }

    /// Table with a shaded bold header; `widths` are fractions of the content width.
    pub fn table(&mut self, headers: &[&str], widths: &[f64], rows: &[Vec<String>]) {
        const ROW_H: f64 = 16.0;
        let cols: Vec<f64> = widths.iter().map(|w| w * CONTENT_W).collect();
        let header = |pdf: &mut Pdf| {
            pdf.ensure(ROW_H * 2.0);
            let top = PAGE_H - pdf.y - ROW_H - 4.0;
            let shade = format!("0.93 g {MARGIN} {top:.2} {CONTENT_W} {ROW_H} re f 0 g\n");
            pdf.emit(shade.into_bytes());
            pdf.y += ROW_H;
            let mut x = MARGIN + 4.0;
            for (h, w) in headers.iter().zip(&cols) {
                pdf.text_at(x, pdf.y, 9.0, true, &fit(h, w - 6.0, 9.0));
                x += w;
            }
        };
        self.y += 6.0;
        header(self);
        for row in rows {
            let pages = self.pages.len();
            self.ensure(ROW_H);
            if self.pages.len() != pages {
                header(self); // repeat the header on the new page
            }
            self.y += ROW_H;
            let mut x = MARGIN + 4.0;
            for (cell, w) in row.iter().zip(&cols) {
                self.text_at(x, self.y, 9.0, false, &fit(cell, w - 6.0, 9.0));
                x += w;
            }
            let line = format!(
                "0.8 G {MARGIN} {:.2} m {} {:.2} l S 0 G\n",
                PAGE_H - self.y - 5.0,
                MARGIN + CONTENT_W,
                PAGE_H - self.y - 5.0
            );
            self.emit(line.into_bytes());
        }
    }

    /// Embeds the JPEG once, scaled to the content width (max 320 pt high).
    pub fn image(&mut self, jpeg: Vec<u8>) -> bool {
        let Some((w, h)) = jpeg_size(&jpeg) else {
            return false;
        };
        let mut draw_w = CONTENT_W;
        let mut draw_h = draw_w * h as f64 / w as f64;
        if draw_h > 320.0 {
            draw_h = 320.0;
            draw_w = draw_h * w as f64 / h as f64;
        }
        self.ensure(draw_h + 10.0);
        self.y += 10.0 + draw_h;
        let op = format!(
            "q {draw_w:.2} 0 0 {draw_h:.2} {MARGIN} {:.2} cm /Im1 Do Q\n",
            PAGE_H - self.y
        );
        self.emit(op.into_bytes());
        self.jpeg = Some((jpeg, w, h));
        true
    }

    /// Serializes the document (objects + xref + trailer).
    pub fn finish(self) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets: Vec<usize> = Vec::new();
        let obj = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n", offsets.len()).into_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        };
        // 1 catalog, 2 pages, 3–4 fonts, 5 image (optional), then page + content pairs.
        let first_page = if self.jpeg.is_some() { 6 } else { 5 };
        let kids: Vec<String> = (0..self.pages.len())
            .map(|i| format!("{} 0 R", first_page + i * 2))
            .collect();
        obj(&mut out, &mut offsets, b"<< /Type /Catalog /Pages 2 0 R >>");
        obj(
            &mut out,
            &mut offsets,
            format!(
                "<< /Type /Pages /Kids [{}] /Count {} >>",
                kids.join(" "),
                self.pages.len()
            )
            .as_bytes(),
        );
        for name in ["Helvetica", "Helvetica-Bold"] {
            obj(&mut out, &mut offsets, format!("<< /Type /Font /Subtype /Type1 /BaseFont /{name} /Encoding /WinAnsiEncoding >>").as_bytes());
        }
        let xobject = if let Some((bytes, w, h)) = &self.jpeg {
            let mut body = format!("<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n", bytes.len()).into_bytes();
            body.extend_from_slice(bytes);
            body.extend_from_slice(b"\nendstream");
            obj(&mut out, &mut offsets, &body);
            " /XObject << /Im1 5 0 R >>"
        } else {
            ""
        };
        for (i, content) in self.pages.iter().enumerate() {
            let content_id = first_page + i * 2 + 1;
            obj(&mut out, &mut offsets, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>{xobject} >> /Contents {content_id} 0 R >>").as_bytes());
            let mut body = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
            body.extend_from_slice(content);
            body.extend_from_slice(b"\nendstream");
            obj(&mut out, &mut offsets, &body);
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).into_bytes());
        for o in &offsets {
            out.extend(format!("{o:010} 00000 n \n").into_bytes());
        }
        out.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                offsets.len() + 1
            )
            .into_bytes(),
        );
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Smallest valid JPEG header for the size parser: SOI + SOF0 (32×16).
    pub fn tiny_jpeg() -> Vec<u8> {
        vec![
            0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22,
            0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9,
        ]
    }

    #[test]
    fn strings_are_escaped_and_winansi() {
        assert_eq!(pdf_string("a(b)\\"), b"(a\\(b\\)\\\\)".to_vec());
        assert_eq!(pdf_string("çã€"), vec![b'(', 0xE7, 0xE3, 0x80, b')']);
        assert_eq!(pdf_string("✓"), b"(?)".to_vec());
    }

    #[test]
    fn jpeg_dimensions() {
        assert_eq!(jpeg_size(&tiny_jpeg()), Some((32, 16)));
        assert_eq!(jpeg_size(b"not a jpeg"), None);
    }

    #[test]
    fn fit_truncates_long_cells() {
        assert_eq!(fit("curto", 100.0, 9.0), "curto");
        let cut = fit(&"x".repeat(200), 50.0, 9.0);
        assert!(cut.ends_with('…') && cut.chars().count() < 20);
    }

    #[test]
    fn document_structure_and_xref_offsets() {
        let mut pdf = Pdf::new();
        pdf.heading("Relatório — Bairro Norte");
        pdf.paragraph("Custo total: 1234,50 €");
        assert!(pdf.image(tiny_jpeg()));
        let bytes = pdf.finish();
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(bytes.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&bytes);
        // Every xref entry points at "<n> 0 obj".
        let xref_at: usize = text
            .rsplit("startxref\n")
            .next()
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        let xref = &text[xref_at..];
        for (n, line) in xref
            .lines()
            .skip(3)
            .take_while(|l| l.ends_with(" n "))
            .enumerate()
        {
            let offset: usize = line[..10].parse().unwrap();
            assert!(
                bytes[offset..].starts_with(format!("{} 0 obj", n + 1).as_bytes()),
                "obj {}",
                n + 1
            );
        }
        assert!(text.contains("/Filter /DCTDecode"));
        assert!(text.contains("/Width 32 /Height 16"));
    }

    #[test]
    fn long_tables_break_pages_and_repeat_the_header() {
        let mut pdf = Pdf::new();
        let rows: Vec<Vec<String>> = (0..120)
            .map(|i| vec![format!("linha {i}"), "1".into()])
            .collect();
        pdf.table(&["Elemento", "Qtd."], &[0.7, 0.3], &rows);
        assert!(pdf.pages.len() >= 3);
        let text = String::from_utf8_lossy(&pdf.finish()).to_string();
        assert!(text.matches("(Elemento)").count() >= 3);
        assert!(text.contains("/Count "));
    }
}
