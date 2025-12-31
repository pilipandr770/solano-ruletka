//! Vendored ORAO VRF (patched minimal)
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use state::{NetworkState, RandomnessV2};

pub use crate::error::Error;

pub mod error;
pub mod events;
pub mod state;
mod sdk;

pub const RANDOMNESS_ACCOUNT_SEED: &[u8] = b"orao-vrf-randomness-request";
pub const CONFIG_ACCOUNT_SEED: &[u8] = b"orao-vrf-network-configuration";

declare_id!("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");

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
pub struct Request<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub network_state: Account<'info, NetworkState>,
    #[account(mut)]
    pub request: Account<'info, RandomnessV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub network_state: Account<'info, NetworkState>,
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    #[account(mut)]
    pub request: Account<'info, RandomnessV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    pub instruction_acc: AccountInfo<'info>,
    #[account(mut)]
    pub network_state: Account<'info, NetworkState>,
    #[account(mut)]
    pub request_acc: Account<'info, RandomnessV2>,
    #[account(mut, constraint = *request_acc.client() == client.key())]
    pub client: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
