# Critical Bug: Missing Anchor Discriminator in Bet Accounts

## Problem

The deployed program at `AV5r5GYG7adU9q1ojmyawExGtx2BAAqhtWa2AAXLNVa8` has a critical bug where:

1. **`place_bet` instruction** creates `BetAccount` without writing the Anchor discriminator
2. **`resolve_bet` instruction** expects the discriminator and fails with `AccountDiscriminatorMismatch`

### Evidence

Bet account `8Frno3QodNTXJXLofyu8UwZVmzMvnPCYhMUZ7Gi52P9i` has:
- First 8 bytes: `75 bb a5 ae c2 1c 77 4c` (this is the table pubkey, NOT a discriminator)
- Expected discriminator for `BetAccount`: `18 7f 11 86 5b 45 e5 99`

## Root Cause

This is likely caused by one of:
1. Anchor version incompatibility (using 0.31.1)
2. Incorrect `#[account]` macro application
3. Build/deployment issue where the wrong binary was deployed

## Solution

### Option 1: Rebuild and Redeploy (Recommended)

```powershell
# Fix build environment
$env:HOME = "C:\Users\ПК"

# Clean and rebuild
cd C:\Users\ПК\solano_ruletka
anchor clean
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Update frontend with new program ID
# Edit frontend/lib/anchor.ts and update PROGRAM_ID
```

### Option 2: Temporary Workaround (NOT recommended)

Modify the Rust program to use `UncheckedAccount` for bet in `ResolveBet`:

```rust
#[derive(Accounts)]
pub struct ResolveBet<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(mut)]
    pub table: Account<'info, Table>,
    /// CHECK: Manually validated bet account (discriminator missing)
    #[account(mut)]
    pub bet: UncheckedAccount<'info>,
    // ... rest of accounts
}
```

Then manually deserialize in `resolve_bet`:
```rust
let mut bet_data: &[u8] = &ctx.accounts.bet.data.borrow();
let bet = BetAccount::try_deserialize(&mut bet_data)?;
```

But this is NOT recommended as it breaks type safety.

## Build Environment Setup

If `anchor build` or `cargo build-sbf` fails:

1. **Install Agave tools**:
```powershell
# Follow https://docs.anza.xyz/cli/install
```

2. **Fix vendor paths** (if you see indexmap errors):
```powershell
cd C:\Users\ПК\solano_ruletka
Remove-Item -Recurse -Force vendor/
# Let Cargo re-download dependencies
```

3. **Verify Rust/Cargo**:
```powershell
cargo --version  # Should show 1.92.0 or later
rustc --version
```

## Testing After Redeploy

1. Create new table with `createTable`
2. Deposit liquidity with `depositLiquidity`
3. Place bet with `placeBet` - verify bet account has discriminator:
   ```powershell
   solana account <BET_PDA> --url devnet
   # First 8 bytes should be: 18 7f 11 86 5b 45 e5 99
   ```
4. Resolve bet with `resolveBet` - should succeed now

##Current Status

- ❌ Bet account `8Frno3QodNTXJXLofyu8UwZVmzMvnPCYhMUZ7Gi52P9i` is unusable (no discriminator)
- ❌ All future bets will have the same issue until program is redeployed
- ⚠️ `refundExpired` will also fail for existing bets

## Next Steps

1. Fix build environment
2. Rebuild program
3. Redeploy to devnet
4. Test full flow (create table → deposit → bet → resolve)
5. Deploy to mainnet only after thorough testing
