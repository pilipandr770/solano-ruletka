//! # ORAO VRF (vendored & patched for local build)
//!
//! This is a vendored copy of orao-solana-vrf v0.6.0 with a minimal fix
//! to avoid a name collision in `FulfillV2` accounts (rename `request` -> `request_acc`).

#![allow(deprecated)]

use anchor_lang::prelude::*;
use state::{NetworkState, OraoTokenFeeConfig, Randomness, RandomnessV2};

pub use crate::error::Error;

pub mod error;

pub mod events;
pub mod state;

mod sdk;
#[cfg(feature = "sdk")]
pub use crate::sdk::*;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

declare_id!("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");

pub const RANDOMNESS_ACCOUNT_SEED: &[u8] = b"orao-vrf-randomness-request";
pub const CONFIG_ACCOUNT_SEED: &[u8] = b"orao-vrf-network-configuration";

#[allow(unused_variables)]
#[program]
pub mod orao_vrf {
    use super::*;

    pub fn request<'info>(
        ctx: Context<'_, '_, '_, 'info, Request<'info>>,
        seed: [u8; 32],
    ) -> Result<()> {
        Ok(())
    }

    pub fn request_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, RequestV2<'info>>,
        seed: [u8; 32],
    ) -> Result<()> {
        Ok(())
    }

    pub fn fulfill_v2(ctx: Context<FulfillV2>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RequestV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + RandomnessV2::PENDING_SIZE,
        seeds = [RANDOMNESS_ACCOUNT_SEED, &seed],
        bump,
    )]
    pub request: Account<'info, RandomnessV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    pub instruction_acc: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [CONFIG_ACCOUNT_SEED],
        bump,
    )]
    pub network_state: Account<'info, NetworkState>,
    // PATCHED: avoid name collision with instruction `request` by renaming param
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, request_acc.seed()],
        bump,
    )]
    pub request_acc: Account<'info, RandomnessV2>,
    #[account(mut, constraint = *request_acc.client() == client.key())]
    pub client: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

// rest of crate omitted for brevity; vendored crate should include all required modules
