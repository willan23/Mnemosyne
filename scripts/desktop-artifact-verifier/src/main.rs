use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path, process};

// Same minisign implementation and verification mode as tauri-plugin-updater 2.14.0.
// Parse the trusted comment only after verifying both signatures.
fn verify(
    data: &[u8],
    signature: &str,
    public_key: &str,
    version: &str,
    filename: &str,
) -> Result<(), ()> {
    let key_bytes = STANDARD.decode(public_key).map_err(|_| ())?;
    let key =
        PublicKey::decode(std::str::from_utf8(&key_bytes).map_err(|_| ())?).map_err(|_| ())?;
    let sig_bytes = STANDARD.decode(signature.trim()).map_err(|_| ())?;
    let sig =
        Signature::decode(std::str::from_utf8(&sig_bytes).map_err(|_| ())?).map_err(|_| ())?;
    key.verify(data, &sig, true).map_err(|_| ())?;
    let fields: Vec<_> = sig.trusted_comment().split('\t').collect();
    let versions: Vec<_> = fields
        .iter()
        .filter_map(|s| s.strip_prefix("version:"))
        .collect();
    let files: Vec<_> = fields
        .iter()
        .filter_map(|s| s.strip_prefix("file:"))
        .collect();
    if versions != [version] || files != [filename] {
        return Err(());
    }
    Ok(())
}

fn run() -> Result<(), ()> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 4 {
        return Err(());
    }
    let artifact = Path::new(&args[0]);
    let filename = artifact.file_name().and_then(|s| s.to_str()).ok_or(())?;
    let size = fs::metadata(artifact).map_err(|_| ())?.len();
    if size == 0 || size > 512 * 1024 * 1024 || args[2].len() > 8192 {
        return Err(());
    }
    if fs::metadata(&args[1]).map_err(|_| ())?.len() > 8192 {
        return Err(());
    }
    let data = fs::read(artifact).map_err(|_| ())?;
    if data.len() as u64 != size {
        return Err(());
    }
    let signature = fs::read_to_string(&args[1]).map_err(|_| ())?;
    verify(&data, &signature, &args[2], &args[3], filename)?;
    println!(
        "{{\"verified\":true,\"bytes\":{},\"sha256\":\"{:x}\"}}",
        data.len(),
        Sha256::digest(&data)
    );
    Ok(())
}

fn main() {
    if run().is_err() {
        eprintln!("Desktop artifact verification refused: check bytes, public key, signature, signed version and filename.");
        process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Public upstream fixture: disposable key, payload `test`, no private key.
    const KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIG: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";
    #[test]
    fn accepts_upstream_signed_vector() {
        assert!(verify(
            b"test",
            &STANDARD.encode(SIG),
            &STANDARD.encode(KEY),
            "2.0.0",
            "payload"
        )
        .is_ok());
    }
    #[test]
    fn refuses_tampered_bytes() {
        assert!(verify(
            b"changed",
            &STANDARD.encode(SIG),
            &STANDARD.encode(KEY),
            "2.0.0",
            "payload"
        )
        .is_err());
    }
    #[test]
    fn refuses_another_version() {
        assert!(verify(
            b"test",
            &STANDARD.encode(SIG),
            &STANDARD.encode(KEY),
            "2.0.1",
            "payload"
        )
        .is_err());
    }
    #[test]
    fn refuses_another_filename() {
        assert!(verify(
            b"test",
            &STANDARD.encode(SIG),
            &STANDARD.encode(KEY),
            "2.0.0",
            "renamed"
        )
        .is_err());
    }
    #[test]
    fn refuses_tampered_trusted_comment() {
        assert!(verify(
            b"test",
            &STANDARD.encode(SIG.replace("version:2.0.0", "version:2.0.1")),
            &STANDARD.encode(KEY),
            "2.0.1",
            "payload"
        )
        .is_err());
    }
}
