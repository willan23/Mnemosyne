# Windows Authenticode (code signing) for Mnemosyne Desktop
#
# Two different signatures exist:
# 1) Updater minisign key  -> TAURI_SIGNING_PRIVATE_KEY (must match configured public key)
# 2) Authenticode (.pfx)   -> Windows SmartScreen trust (this document)
#
# Builds work WITHOUT Authenticode. Add the certificate when you want fewer
# SmartScreen warnings for public downloads.

The updater key was migrated locally for candidate 1.0.9 after the operator lost the previous password. See [Windows updater key migration](MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md): old clients need a manual install; the legacy feed remains unchanged and new clients use `/desktop/v2/latest.json`. The new local private key is protected with Windows DPAPI outside Git. Backup/restore and CI custody are still required before rollout. Authenticode is a separate signing mechanism; this migration does not add a Windows publisher certificate.

## Local one-time setup

1. If using Authenticode, provide an existing supported signing certificate/service. A certificate purchase is not required by this release procedure.
2. Never commit the `.pfx` or password to git.
3. Import + patch Tauri config:

```powershell
# Supply WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD through your secret source.
# Do not put a certificate password in shell history or process arguments.
.\scripts\import-windows-certificate.ps1 -FromEnv -PatchTauriConfig

# For the local DPAPI updater key, use the protected wrapper from the repository root.
.\scripts\desktop-updater-key.ps1 -Action Build -KeyDirectory W:\real\mnemosyne-launch-secrets\desktop-updater-epoch2-20261024
```

4. Publish:

```powershell
powershell -File scripts/publish-desktop.ps1 -Version 1.0.9 -Notes "Windows updater key migration"
powershell -NoProfile -File deploy.ps1 -Project mnemosyne-one
```

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `WINDOWS_CERTIFICATE` | Base64 of the `.pfx` file |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| `TAURI_SIGNING_PRIVATE_KEY` | Updater private key (minisign) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password (if any) |
| `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_PROJECT_ID` | Full validated Firebase deployment (service account JSON; `FIREBASE_TOKEN` / `firebase login:ci` está descontinuado) |

Encode the PFX (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\secure\mnemosyne-codesign.pfx")) | Set-Clipboard
```

The workflow `Desktop Release (Windows)` imports the PFX when
`WINDOWS_CERTIFICATE` is present, patches `tauri.windows.conf.json` with the
thumbprint, then builds. If the secret is missing, the job builds without Authenticode.
Both NSIS and MSI must still carry valid minisign signatures bound to the release
version and filename. Staging verifies them with the configured public key.
`-DeployHosting` is refused; the optional workflow input `deploy_release` invokes
the full procedure after all release criteria are met. See
[verified desktop staging](PUBLICACAO_DESKTOP_VERIFICADA.md) for exact artifact
selection, feed verification and interruption behavior. The public updater key is
preserved; replacing it requires an explicit migration for installed clients.

## Verify a signed installer

```powershell
Get-AuthenticodeSignature .\frontend\public\downloads\mnemosyne-desktop-setup.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

`Status` should be `Valid` after Authenticode signing.

## Notes (2024+)

Many CAs no longer issue exportable OV certs on plain `.pfx` files and require
HSM / Azure Key Vault / cloud signing. If your CA forces that model, keep the
same CI secrets model but switch `bundle.windows.signCommand` in
`tauri.windows.conf.json` to your cloud signer (e.g. Azure Trusted Signing /
relic). The import script above covers classic `.pfx` flows still used with
some providers and legacy exportable certificates.
