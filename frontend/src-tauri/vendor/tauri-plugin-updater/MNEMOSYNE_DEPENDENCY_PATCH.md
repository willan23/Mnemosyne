# Local dependency patch

Upstream: tauri-plugin-updater 2.14.0, crates.io archive SHA-256 7259989d4fe11b2bf51f7d671642249b1837c4ae2da1430dc713ae38f98ceeec.

All shipped upstream source, permissions and licence files are unchanged. The normalized Cargo.toml changes only the Windows zip dependency from major 4 to major 9 to consume the fixes for RUSTSEC-2026-0367, RUSTSEC-2026-0368 and RUSTSEC-2026-0369. ZIP update support remains enabled. The upstream Cargo.lock and Cargo cache markers are not vendored. Cargo.toml.orig remains the original upstream manifest.

Remove this patch after an upstream stable updater release includes a fixed ZIP dependency and the release validation passes against that version. This patch does not certify installers, signatures or native runtime acceptance.
