//! Terrain heightmap generation (PLAN.md Fase 3).
//!
//! The core owns procedural generation: a heightmap of `res * res` heights
//! (meters, row-major, world x/z from `-size/2` to `size/2`) is built from
//! Perlin fBm noise and returned to the frontend, which feeds it into a
//! subdivided `PlaneGeometry`. Brush edits happen on the frontend heightmap.
//!
//! Presets (PLAN.md Fase 3):
//!  - `flat`: all zeros;
//!  - `mountains`: fBm with 6 octaves, 40 m amplitude;
//!  - `valley`: fBm with 4 octaves, 15 m amplitude, minus a central ridge
//!    depression that carves the valley;
//!  - `custom`: fBm with 4 octaves driven by `seed`/`amplitude`/`frequency`.

use noise::{NoiseFn, Perlin};

use crate::error::AppError;

/// Terrain presets known to the core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerrainPreset {
    Flat,
    Mountains,
    Valley,
    Custom,
}

impl TerrainPreset {
    pub fn parse(preset: &str) -> Result<Self, AppError> {
        match preset {
            "flat" => Ok(Self::Flat),
            "mountains" => Ok(Self::Mountains),
            "valley" => Ok(Self::Valley),
            "custom" => Ok(Self::Custom),
            other => Err(AppError::UnknownTerrainPreset(other.to_string())),
        }
    }
}

/// Limits for the generation inputs (grid memory stays sane).
pub const MIN_RES: u32 = 2;
pub const MAX_RES: u32 = 512;
pub const MIN_SIZE: u32 = 10;
pub const MAX_SIZE: u32 = 5000;

/// Base spatial frequency of the noise: cycles per meter before the
/// user-facing `frequency` multiplier. Sized so a 200 m terrain shows a
/// handful of large features plus detail from the octaves.
const BASE_FREQUENCY: f64 = 0.012;

/// Fraction of the terrain half-size that the valley depression spans.
const VALLEY_RADIUS_RATIO: f64 = 1.0;
/// Depth of the valley at its center (meters).
const VALLEY_DEPTH: f64 = 18.0;

/// Validates the grid parameters shared by all presets.
pub fn validate_grid(size: u32, res: u32) -> Result<(), AppError> {
    if !(MIN_RES..=MAX_RES).contains(&res) {
        return Err(AppError::InvalidTerrainParams(format!(
            "resolution {res} outside {MIN_RES}..={MAX_RES}"
        )));
    }
    if !(MIN_SIZE..=MAX_SIZE).contains(&size) {
        return Err(AppError::InvalidTerrainParams(format!(
            "size {size} outside {MIN_SIZE}..={MAX_SIZE}"
        )));
    }
    Ok(())
}

/// Fractional Brownian motion: sum of octaves with halving amplitude and
/// doubling frequency, normalized back to roughly [-1, 1].
fn fbm(noise: &Perlin, x: f64, y: f64, octaves: u32) -> f64 {
    let mut sum = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = 1.0;
    let mut norm = 0.0;
    for _ in 0..octaves {
        sum += noise.get([x * frequency, y * frequency]) * amplitude;
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    sum / norm
}

/// Parabolic depression centered on the terrain: deepest at the center and
/// fading to zero at `VALLEY_RADIUS_RATIO * size / 2` from it.
fn ridge(wx: f64, wz: f64, size: u32) -> f64 {
    let radius = size as f64 / 2.0 * VALLEY_RADIUS_RATIO;
    let dist = (wx * wx + wz * wz).sqrt();
    let t = (1.0 - (dist / radius).powi(2)).max(0.0);
    VALLEY_DEPTH * t
}

/// Generates the heightmap for a preset. `amplitude`/`frequency` only apply
/// to `custom`; the built-in presets use their fixed signature values.
pub fn generate_heightmap(
    preset: TerrainPreset,
    size: u32,
    res: u32,
    seed: u32,
    amplitude: f64,
    frequency: f64,
) -> Result<Vec<f32>, AppError> {
    validate_grid(size, res)?;
    if preset == TerrainPreset::Custom {
        if !(amplitude.is_finite() && amplitude > 0.0 && amplitude <= 500.0) {
            return Err(AppError::InvalidTerrainParams(
                "amplitude must be between 0 and 500".into(),
            ));
        }
        if !(frequency.is_finite() && frequency > 0.0 && frequency <= 100.0) {
            return Err(AppError::InvalidTerrainParams(
                "frequency must be between 0 and 100".into(),
            ));
        }
    }

    let noise = Perlin::new(seed);
    let cells = (res - 1) as f64;
    let mut heightmap = Vec::with_capacity((res * res) as usize);

    for gz in 0..res {
        for gx in 0..res {
            // World coordinates of this vertex (matches ui/src/scene/terrain.ts).
            let wx = (gx as f64 / cells - 0.5) * size as f64;
            let wz = (gz as f64 / cells - 0.5) * size as f64;
            let nx = wx * BASE_FREQUENCY;
            let nz = wz * BASE_FREQUENCY;

            let height = match preset {
                TerrainPreset::Flat => 0.0,
                TerrainPreset::Mountains => fbm(&noise, nx, nz, 6) * 40.0,
                TerrainPreset::Valley => fbm(&noise, nx, nz, 4) * 15.0 - ridge(wx, wz, size),
                TerrainPreset::Custom => fbm(&noise, nx * frequency, nz * frequency, 4) * amplitude,
            };
            heightmap.push(height as f32);
        }
    }

    Ok(heightmap)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate(preset: &str, size: u32, res: u32, seed: u32) -> Vec<f32> {
        generate_heightmap(
            TerrainPreset::parse(preset).unwrap(),
            size,
            res,
            seed,
            10.0,
            1.0,
        )
        .unwrap()
    }

    #[test]
    fn flat_is_all_zeros() {
        let map = generate("flat", 200, 64, 42);
        assert_eq!(map.len(), 64 * 64);
        assert!(map.iter().all(|&h| h == 0.0));
    }

    #[test]
    fn output_length_is_res_squared() {
        for res in [2, 17, 128] {
            assert_eq!(
                generate("mountains", 200, res, 1).len(),
                (res * res) as usize
            );
        }
    }

    #[test]
    fn same_seed_is_deterministic() {
        let a = generate("mountains", 200, 64, 7);
        let b = generate("mountains", 200, 64, 7);
        assert_eq!(a, b);
    }

    #[test]
    fn different_seeds_differ() {
        let a = generate("mountains", 200, 64, 1);
        let b = generate("mountains", 200, 64, 2);
        assert_ne!(a, b);
    }

    #[test]
    fn mountains_stay_within_amplitude_bounds() {
        let map = generate("mountains", 200, 64, 3);
        let max = map.iter().fold(0.0_f32, |m, &h| m.max(h.abs()));
        assert!(max > 1.0, "expected real relief, got max {max}");
        assert!(max <= 40.0, "fbm is normalized, got max {max}");
    }

    #[test]
    fn ridge_is_deepest_at_center_and_zero_at_edge() {
        let size = 200;
        let center = ridge(0.0, 0.0, size);
        assert!((center - VALLEY_DEPTH).abs() < 1e-9);
        // At and beyond the valley radius the depression is exactly zero.
        assert_eq!(ridge(100.0, 0.0, size), 0.0);
        assert_eq!(ridge(0.0, -150.0, size), 0.0);
        // Monotonic decrease along the radius.
        assert!(ridge(20.0, 0.0, size) > ridge(60.0, 0.0, size));
    }

    #[test]
    fn valley_applies_the_ridge_depression() {
        // Valley = fbm(4 octaves) * 15 - ridge, so at the center the height is
        // at most 15 - VALLEY_DEPTH (fbm is normalized to [-1, 1]).
        let res = 65;
        let map = generate("valley", 200, res, 5);
        let center = map[((res / 2) * res + res / 2) as usize];
        assert!(center <= 15.0 - VALLEY_DEPTH as f32 + f32::EPSILON);
    }

    #[test]
    fn custom_amplitude_scales_relief() -> Result<(), AppError> {
        let low = generate_heightmap(TerrainPreset::Custom, 200, 64, 9, 5.0, 1.0)?;
        let high = generate_heightmap(TerrainPreset::Custom, 200, 64, 9, 20.0, 1.0)?;
        let peak = |m: &[f32]| m.iter().fold(0.0_f32, |acc, &h| acc.max(h.abs()));
        let ratio = peak(&high) / peak(&low);
        // Same normalized noise field, so peaks scale with amplitude.
        assert!((ratio - 4.0).abs() < 1e-4, "unexpected ratio {ratio}");
        Ok(())
    }

    #[test]
    fn custom_frequency_changes_output() -> Result<(), AppError> {
        let a = generate_heightmap(TerrainPreset::Custom, 200, 64, 9, 10.0, 1.0)?;
        let b = generate_heightmap(TerrainPreset::Custom, 200, 64, 9, 10.0, 3.0)?;
        assert_ne!(a, b);
        Ok(())
    }

    #[test]
    fn rejects_unknown_preset() {
        assert!(TerrainPreset::parse("lunar").is_err());
    }

    #[test]
    fn rejects_out_of_range_grid() {
        assert!(generate_heightmap(TerrainPreset::Flat, 200, 1, 1, 10.0, 1.0).is_err());
        assert!(generate_heightmap(TerrainPreset::Flat, 200, 513, 1, 10.0, 1.0).is_err());
        assert!(generate_heightmap(TerrainPreset::Flat, 5, 64, 1, 10.0, 1.0).is_err());
    }

    #[test]
    fn rejects_invalid_custom_params() {
        assert!(generate_heightmap(TerrainPreset::Custom, 200, 64, 1, 0.0, 1.0).is_err());
        assert!(generate_heightmap(TerrainPreset::Custom, 200, 64, 1, 10.0, -2.0).is_err());
    }
}
