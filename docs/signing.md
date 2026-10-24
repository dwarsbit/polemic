# Code signing

The release workflow (`.github/workflows/release.yml`) signs the macOS
and Windows builds once the secrets below exist. Until then those builds
are unsigned and the run shows a warning. If only some secrets of a
platform are set, the build fails and names the missing one.

Add secrets under **GitHub → Settings → Secrets and variables →
Actions → New repository secret**.

## macOS: Developer ID and notarization

Unsigned macOS builds get blocked by Gatekeeper ("Polemic is damaged" or
"cannot be opened"). Signing plus notarization removes that.

1. **Join the Apple Developer Program** (USD 99/year) at
   <https://developer.apple.com/programs/>. Note your **Team ID** under
   Membership details.
2. **Create a Developer ID Application certificate.** On a Mac, open
   Keychain Access → Certificate Assistant → _Request a Certificate From
   a Certificate Authority_, save the request to disk. Then at
   <https://developer.apple.com/account/resources/certificates> create a
   certificate of type **Developer ID Application**, upload the request,
   download the `.cer` and double-click it to add it to your keychain.
3. **Export it as `.p12`.** In Keychain Access → _My Certificates_,
   right-click _Developer ID Application: Your Name (TEAMID)_ → Export,
   choose `.p12` and set a password.
4. **Create an app-specific password** at <https://account.apple.com>
   → Sign-In and Security → App-Specific Passwords. Notarization logs in
   with this, not your normal password.
5. **Find the signing identity:**
   `security find-identity -v -p codesigning` prints
   `Developer ID Application: Your Name (TEAMID)`.
6. **Add the secrets:**

   | Secret                       | Value                                               |
   | ---------------------------- | --------------------------------------------------- |
   | `APPLE_CERTIFICATE`          | Output of `base64 -i certificate.p12 \| tr -d '\n'` |
   | `APPLE_CERTIFICATE_PASSWORD` | Password you set when exporting the `.p12`          |
   | `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: Your Name (TEAMID)`      |
   | `APPLE_ID`                   | Email of your Apple ID                              |
   | `APPLE_PASSWORD`             | The app-specific password from step 4               |
   | `APPLE_TEAM_ID`              | Team ID from step 1                                 |

## Windows: Azure Artifact Signing

Unsigned Windows installers trigger a SmartScreen "Windows protected
your PC" warning. Azure Artifact Signing (formerly Trusted Signing)
issues and holds the certificate for you, so there is no file or
hardware token to manage. It costs about USD 10/month (Basic tier).

1. **Get an Azure subscription** at <https://portal.azure.com>.
2. **Register the resource provider.** Subscriptions → your
   subscription → Resource providers → register
   `Microsoft.CodeSigning`.
3. **Create an Artifact Signing account.** Search _Artifact Signing
   Accounts_ → Create. Pick a region and the Basic tier. Note the
   **account name** and the **endpoint** on its overview page (e.g.
   `https://weu.codesigning.azure.net`).
4. **Validate your identity.** In the account → Identity validation →
   New, choose **Public** (Individual or Organization). Microsoft checks
   your identity; this can take a few days. To do this, your user needs
   the _Artifact Signing Identity Verifier_ role on the account
   (Access control (IAM) → Add role assignment).
5. **Create a certificate profile.** In the account → Certificate
   profiles → Create, type **Public Trust**, select the validated
   identity. Note the **profile name**.
6. **Create an app registration for CI.** Microsoft Entra ID → App
   registrations → New registration (any name, e.g. `polemic-ci`). Note
   the **Application (client) ID** and **Directory (tenant) ID**. Under
   Certificates & secrets → New client secret, copy the secret **value**
   (shown once).
7. **Allow the app to sign.** In the Artifact Signing account → Access
   control (IAM) → Add role assignment → **Artifact Signing Certificate
   Profile Signer** → assign to the app registration from step 6.
8. **Add the secrets:**

   | Secret                                       | Value                               |
   | -------------------------------------------- | ----------------------------------- |
   | `AZURE_CLIENT_ID`                            | Application (client) ID from step 6 |
   | `AZURE_CLIENT_SECRET`                        | Client secret value from step 6     |
   | `AZURE_TENANT_ID`                            | Directory (tenant) ID from step 6   |
   | `AZURE_ARTIFACT_SIGNING_ENDPOINT`            | Endpoint from step 3                |
   | `AZURE_ARTIFACT_SIGNING_ACCOUNT`             | Account name from step 3            |
   | `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | Profile name from step 5            |

The client secret expires (at most after 24 months); renew it in the app
registration and update `AZURE_CLIENT_SECRET` before then.

## Checking a release

After pushing a tag, open the Release run in the Actions tab. A
_Configure macOS signing_ or _Configure Windows signing_ step without a
warning means that platform was signed. On a downloaded build:

- macOS: `spctl -a -vv /Applications/Polemic.app` should say
  `accepted, source=Notarized Developer ID`.
- Windows: right-click the installer → Properties → Digital Signatures
  should list your name.
