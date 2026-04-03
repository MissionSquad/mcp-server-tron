export function renderOAuthWalletPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TRON MCP Authorization</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top right, rgba(255, 78, 80, 0.18), transparent 35%),
          linear-gradient(180deg, #fff7f5 0%, #fff 100%);
        color: #1f2937;
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        background: rgba(255,255,255,0.95);
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 20px;
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        margin: 0 0 14px;
        line-height: 1.5;
      }
      .actions {
        display: grid;
        gap: 12px;
        margin-top: 20px;
      }
      button {
        border: 0;
        border-radius: 12px;
        padding: 14px 16px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
      }
      .primary {
        background: #111827;
        color: white;
      }
      .secondary {
        background: #fee2e2;
        color: #991b1b;
      }
      .panel {
        display: none;
        margin-top: 18px;
        padding: 16px;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .panel.visible {
        display: block;
      }
      .secret {
        word-break: break-all;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #111827;
        color: #fff;
        border-radius: 10px;
        padding: 12px;
        margin: 12px 0;
      }
      .status {
        margin-top: 14px;
        padding: 12px;
        border-radius: 10px;
        font-size: 14px;
      }
      .status.error {
        background: #fee2e2;
        color: #991b1b;
      }
      .status.info {
        background: #e0f2fe;
        color: #075985;
      }
      .status.success {
        background: #dcfce7;
        color: #166534;
      }
      label {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 14px;
        line-height: 1.4;
        margin-top: 10px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Authorize TRON MCP Access</h1>
      <p>
        This server uses OAuth2 for MissionSquad compatibility. During authorization you can either
        prove ownership of an existing managed wallet or create a new managed wallet.
      </p>

      <div class="actions">
        <button id="connect-existing" class="primary">Connect Existing Managed Wallet</button>
        <button id="create-wallet" class="secondary">Create New Managed Wallet</button>
      </div>

      <section id="create-wallet-panel" class="panel" aria-live="polite">
        <p><strong>Save this private key now.</strong> It is shown exactly once.</p>
        <div><strong>Wallet Address</strong></div>
        <div id="created-wallet-address" class="secret"></div>
        <div><strong>Private Key</strong></div>
        <div id="created-private-key" class="secret"></div>
        <label>
          <input id="saved-private-key" type="checkbox" />
          <span>I have saved this private key securely and understand it will not be shown again.</span>
        </label>
        <div class="actions">
          <button id="complete-create-wallet" class="primary" disabled>Continue to MissionSquad</button>
        </div>
      </section>

      <div id="status" class="status info" hidden>Ready.</div>
    </main>

    <script>
      const statusEl = document.getElementById("status");
      const createPanel = document.getElementById("create-wallet-panel");
      const connectExistingButton = document.getElementById("connect-existing");
      const createWalletButton = document.getElementById("create-wallet");
      const createdWalletAddressEl = document.getElementById("created-wallet-address");
      const createdPrivateKeyEl = document.getElementById("created-private-key");
      const savedPrivateKeyCheckbox = document.getElementById("saved-private-key");
      const completeCreateWalletButton = document.getElementById("complete-create-wallet");

      let pendingRedirect = null;

      function setStatus(kind, message) {
        statusEl.hidden = false;
        statusEl.className = "status " + kind;
        statusEl.textContent = message;
      }

      async function requestJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(body),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || payload.message || "Request failed.");
        }
        return payload;
      }

      async function getInjectedTronWeb() {
        const provider = window.tron || window.tronWeb;
        if (!provider) {
          throw new Error("No TRON browser wallet was found. Install TronLink or another compatible wallet.");
        }

        if (window.tron && typeof window.tron.request === "function") {
          try {
            await window.tron.request({ method: "eth_requestAccounts" });
          } catch (error) {
            throw new Error("Wallet connection was rejected.");
          }
        }

        const tronWeb = window.tronWeb || (window.tron && window.tron.tronWeb) || provider;
        if (!tronWeb || !tronWeb.defaultAddress || !tronWeb.defaultAddress.base58) {
          throw new Error("Unable to read the connected TRON wallet address.");
        }
        return tronWeb;
      }

      async function connectExistingManagedWallet() {
        setStatus("info", "Connecting browser wallet...");
        const tronWeb = await getInjectedTronWeb();
        const walletAddress = tronWeb.defaultAddress.base58;
        setStatus("info", "Requesting wallet challenge...");
        const challengeResponse = await requestJson("/oauth/authorize/challenge", { walletAddress });

        setStatus("info", "Waiting for wallet signature...");
        const signature = await tronWeb.trx.signMessageV2(challengeResponse.challenge);

        setStatus("info", "Verifying wallet proof...");
        const verifyResponse = await requestJson("/oauth/authorize/verify", {
          walletAddress,
          challenge: challengeResponse.challenge,
          signature,
        });

        setStatus("success", "Wallet verified. Redirecting to MissionSquad...");
        window.location.assign(verifyResponse.redirectTo);
      }

      async function createManagedWallet() {
        setStatus("info", "Creating managed wallet...");
        const response = await requestJson("/oauth/authorize/create-wallet", {});
        pendingRedirect = response.redirectTo;
        createdWalletAddressEl.textContent = response.walletAddress;
        createdPrivateKeyEl.textContent = response.privateKey;
        createPanel.classList.add("visible");
        savedPrivateKeyCheckbox.checked = false;
        completeCreateWalletButton.disabled = true;
        setStatus("success", "Managed wallet created. Save the private key before continuing.");
      }

      connectExistingButton.addEventListener("click", () => {
        connectExistingManagedWallet().catch((error) => {
          setStatus("error", error instanceof Error ? error.message : String(error));
        });
      });

      createWalletButton.addEventListener("click", () => {
        createManagedWallet().catch((error) => {
          setStatus("error", error instanceof Error ? error.message : String(error));
        });
      });

      savedPrivateKeyCheckbox.addEventListener("change", () => {
        completeCreateWalletButton.disabled = !savedPrivateKeyCheckbox.checked || !pendingRedirect;
      });

      completeCreateWalletButton.addEventListener("click", () => {
        if (pendingRedirect) {
          setStatus("success", "Redirecting to MissionSquad...");
          window.location.assign(pendingRedirect);
        }
      });
    </script>
  </body>
</html>`;
}
