# Provably-Fair Roulette Table (Solana, Anchor)

This repository contains an Anchor program implementing a provably-fair European Roulette table (0..36) using ORAO VRF, USDC (SPL) as staking asset and a 100-supply GOV token for governance/operator control.

Features:

See Anchor.toml for configuration and tests/ for a minimal test scaffold.

Frontend
--------
A minimal Next.js frontend is provided in the `frontend` folder. It includes Solana wallet connection (Phantom) and a simple control panel UI.

Setup (PowerShell)
```powershell
cd c:\Users\ПК\solano_ruletka\frontend
npm install
cp .env.example .env.local
# edit .env.local and set NEXT_PUBLIC_RPC_URL and program/mint addresses
npm run dev
```

