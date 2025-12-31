#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// ORAO VRF CPI
use orao_solana_vrf::{
    cpi as orao_cpi,
    state::RandomnessAccountData,
    CONFIG_ACCOUNT_SEED,
    RANDOMNESS_ACCOUNT_SEED,
};

use std::str::FromStr;

declare_id!("ErfuhJxxpHNKviT5LCnupGhSUbXpjfRThxikEgb94aDt");

pub const GOV_TOTAL_SUPPLY: u64 = 100;
pub const OPERATOR_THRESHOLD: u64 = 51;
pub const BET_TIMEOUT_SECONDS: i64 = 1800; // 30 minutes
pub const WITHDRAW_DELAY_SECONDS: i64 = 48 * 3600; // 48 hours default for PUBLIC
pub const ROULETTE_MOD: u64 = 37;

#[program]
pub mod roulette_table {
    use super::*;

    pub fn create_table(
        ctx: Context<CreateTable>,
        seed: u64,
        mode: TableMode,
        min_bet: u64,
        max_bet: u64,
    ) -> Result<()> {
        require!(min_bet > 0, RouletteError::InvalidBetRange);
        require!(max_bet >= min_bet, RouletteError::InvalidBetRange);

        let table = &mut ctx.accounts.table;
        table.seed = seed;
        table.creator = ctx.accounts.creator.key();
        table.operator = ctx.accounts.creator.key();
        table.mode = mode;
        table.paused = false;

        table.usdc_mint = ctx.accounts.usdc_mint.key();
        table.gov_mint = ctx.accounts.gov_mint.key();
        table.global_state = ctx.accounts.global_state.key();
        table.control_vault_gov = ctx.accounts.control_vault_gov.key();

        table.min_bet = min_bet;
        table.max_bet = max_bet;

        table.locked_liability = 0;
        table.active_bets = 0;
        table.bet_seq = 0;

        table.withdraw_request_ts = 0;
        table.withdraw_request_amount = 0;

        table.bumps = TableBumps {
            table: ctx.bumps.table,
            control_vault_gov: ctx.bumps.control_vault_gov,
        };

        Ok(())
    }

    pub fn init_global(ctx: Context<InitGlobal>) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;
        gs.usdc_mint = ctx.accounts.usdc_mint.key();
        gs.vault_usdc = ctx.accounts.global_vault_usdc.key();
        gs.total_locked_liability = 0;
        gs.total_active_bets = 0;
        gs.bumps = GlobalBumps {
            global: ctx.bumps.global_state,
            vault_usdc: ctx.bumps.global_vault_usdc,
        };
        Ok(())
    }

    // --- GOV / management ---

    pub fn deposit_gov(ctx: Context<DepositGov>, amount: u64) -> Result<()> {
        require!(amount > 0, RouletteError::InvalidAmount);

        // transfer GOV -> control_vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_gov_ata.to_account_info(),
            to: ctx.accounts.control_vault_gov.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // update deposit record
        let dep = &mut ctx.accounts.gov_deposit;
        dep.table = ctx.accounts.table.key();
        dep.depositor = ctx.accounts.depositor.key();
        dep.amount = dep.amount.saturating_add(amount);

        Ok(())
    }

    pub fn withdraw_gov(ctx: Context<WithdrawGov>, amount: u64) -> Result<()> {
        require!(amount > 0, RouletteError::InvalidAmount);

        let table = &ctx.accounts.table;
        let dep = &mut ctx.accounts.gov_deposit;

        if table.operator == dep.depositor {
            let remaining = dep.amount.saturating_sub(amount);
            require!(remaining >= OPERATOR_THRESHOLD, RouletteError::OperatorCantDropBelowThreshold);
        }

        require!(dep.amount >= amount, RouletteError::InsufficientGovDeposit);
        dep.amount -= amount;

        // PDA signer: control_vault_gov owner = table PDA
        let seed_bytes = table.seed.to_le_bytes();
        let bump = [table.bumps.table];
        let signer_seeds: &[&[&[u8]]] = &[&[b"table", table.creator.as_ref(), &seed_bytes, &bump]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.control_vault_gov.to_account_info(),
            to: ctx.accounts.depositor_gov_ata.to_account_info(),
            authority: table.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn claim_operator(ctx: Context<ClaimOperator>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let dep = &ctx.accounts.gov_deposit;

        require!(dep.amount >= OPERATOR_THRESHOLD, RouletteError::NotEnoughGovToOperate);
        table.operator = dep.depositor;

        Ok(())
    }

    pub fn set_mode(ctx: Context<OnlyOperator>, mode: TableMode) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.mode = mode;
        Ok(())
    }

    pub fn pause(ctx: Context<OnlyOperator>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<OnlyOperator>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.paused = false;
        Ok(())
    }

    // --- liquidity ---

    pub fn deposit_liquidity_usdc(ctx: Context<DepositLiquidityUsdc>, amount: u64) -> Result<()> {
        require!(amount > 0, RouletteError::InvalidAmount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.operator_usdc_ata.to_account_info(),
            to: ctx.accounts.global_vault_usdc.to_account_info(),
            authority: ctx.accounts.operator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn request_withdraw(ctx: Context<OnlyOperator>, amount: u64) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.mode == TableMode::Public, RouletteError::NotInPublicMode);
        require!(amount > 0, RouletteError::InvalidAmount);

        require!(table.active_bets == 0, RouletteError::ActiveBetsExist);
        require!(table.locked_liability == 0, RouletteError::LiabilityLocked);

        table.withdraw_request_amount = amount;
        table.withdraw_request_ts = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn execute_withdraw(ctx: Context<WithdrawLiquidityUsdc>, amount: u64) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(amount > 0, RouletteError::InvalidAmount);

        require!(table.active_bets == 0, RouletteError::ActiveBetsExist);
        require!(table.locked_liability == 0, RouletteError::LiabilityLocked);

        if table.mode == TableMode::Public {
            require!(table.withdraw_request_amount == amount, RouletteError::WithdrawRequestMismatch);
            let now = Clock::get()?.unix_timestamp;
            require!(
                now.saturating_sub(table.withdraw_request_ts) >= WITHDRAW_DELAY_SECONDS,
                RouletteError::WithdrawDelayNotPassed
            );
            table.withdraw_request_amount = 0;
            table.withdraw_request_ts = 0;
        }

        // Withdraw from shared global vault (signed by GlobalState PDA)
        let gs = &mut ctx.accounts.global_state;
        let signer_seeds: &[&[&[u8]]] = &[&[b"global", gs.usdc_mint.as_ref(), &[gs.bumps.global]]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.global_vault_usdc.to_account_info(),
            to: ctx.accounts.operator_usdc_ata.to_account_info(),
            authority: gs.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    // --- game (USDC + ORAO VRF) ---

    pub fn place_bet(ctx: Context<PlaceBet>, bet: BetKind, stake: u64, force: [u8; 32]) -> Result<()> {
        let table = &mut ctx.accounts.table;

        require!(!table.paused, RouletteError::Paused);
        require!(stake >= table.min_bet && stake <= table.max_bet, RouletteError::InvalidStake);

        validate_bet_kind(&bet)?;

        let multiplier = bet_multiplier(&bet);
        let max_total_payout = stake
            .checked_mul((multiplier + 1) as u64)
            .ok_or(RouletteError::MathOverflow)?;

        let gs = &mut ctx.accounts.global_state;

        let vault_balance = ctx.accounts.global_vault_usdc.amount;
        let available = vault_balance.saturating_sub(gs.total_locked_liability);
        require!(available >= max_total_payout, RouletteError::InsufficientLiquidity);

        let cpi_accounts = Transfer {
            from: ctx.accounts.player_usdc_ata.to_account_info(),
            to: ctx.accounts.global_vault_usdc.to_account_info(),
            authority: ctx.accounts.player.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, stake)?;

        table.locked_liability = table.locked_liability.saturating_add(max_total_payout);
        table.active_bets = table.active_bets.saturating_add(1);
        table.bet_seq = table.bet_seq.saturating_add(1);

        gs.total_locked_liability = gs.total_locked_liability.saturating_add(max_total_payout);
        gs.total_active_bets = gs.total_active_bets.saturating_add(1);

        let now = Clock::get()?.unix_timestamp;
        let bet_acc = &mut ctx.accounts.bet;
        bet_acc.table = table.key();
        bet_acc.player = ctx.accounts.player.key();
        bet_acc.stake = stake;
        bet_acc.multiplier = multiplier;
        bet_acc.max_total_payout = max_total_payout;
        bet_acc.kind = bet;
        bet_acc.state = BetState::Pending;
        bet_acc.created_ts = now;
        bet_acc.force = force;
        bet_acc.randomness_account = ctx.accounts.random.key();

        // ORAO VRF CPI: request randomness
        let cpi_program = ctx.accounts.vrf.to_account_info();
        let cpi_accounts = orao_cpi::accounts::RequestV2 {
            payer: ctx.accounts.player.to_account_info(),
            network_state: ctx.accounts.config.clone(),
            treasury: ctx.accounts.treasury.clone(),
            request: ctx.accounts.random.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        orao_cpi::request_v2(cpi_ctx, force)?;

        Ok(())
    }

    pub fn resolve_bet(ctx: Context<ResolveBet>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let bet = &mut ctx.accounts.bet;

        require!(bet.state == BetState::Pending, RouletteError::BetNotPending);
        // Read ORAO randomness account and ensure it's fulfilled
        let mut data: &[u8] = &ctx.accounts.random.data.borrow();
        let randomness_state = RandomnessAccountData::try_deserialize_unchecked(&mut data)
            .map_err(|_| RouletteError::RandomnessDecodeFailed)?;
        let fulfilled = randomness_state.fulfilled_randomness();
        require!(fulfilled.is_some(), RouletteError::RandomnessNotFulfilled);
        let rnd = fulfilled.unwrap();

        let n = roulette_number_from_randomness(&rnd);

        let won = bet_covers_number(&bet.kind, n);
        let total_payout = if won {
            bet.stake
                .checked_mul((bet.multiplier + 1) as u64)
                .ok_or(RouletteError::MathOverflow)?
        } else {
            0
        };


        if total_payout > 0 {
            // Sign as GlobalState PDA to move funds from the global vault
            let gs = &mut ctx.accounts.global_state;
            let signer_seeds: &[&[&[u8]]] = &[&[b"global", gs.usdc_mint.as_ref(), &[gs.bumps.global]]];
            let cpi_accounts = Transfer {
                from: ctx.accounts.global_vault_usdc.to_account_info(),
                to: ctx.accounts.player_usdc_ata.to_account_info(),
                authority: gs.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, total_payout)?;
        }

        table.locked_liability = table.locked_liability.saturating_sub(bet.max_total_payout);
        table.active_bets = table.active_bets.saturating_sub(1);
        let gs = &mut ctx.accounts.global_state;
        gs.total_locked_liability = gs.total_locked_liability.saturating_sub(bet.max_total_payout);
        gs.total_active_bets = gs.total_active_bets.saturating_sub(1);

        bet.state = BetState::Resolved;
        bet.result_number = Some(n);

        Ok(())
    }

    pub fn refund_expired_bet(ctx: Context<RefundExpiredBet>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let bet = &mut ctx.accounts.bet;

        require!(bet.state == BetState::Pending, RouletteError::BetNotPending);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now.saturating_sub(bet.created_ts) >= BET_TIMEOUT_SECONDS,
            RouletteError::BetNotExpired
        );

        // Refund from global vault (signed by GlobalState PDA)
        let gs = &mut ctx.accounts.global_state;
        let signer_seeds: &[&[&[u8]]] = &[&[b"global", gs.usdc_mint.as_ref(), &[gs.bumps.global]]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.global_vault_usdc.to_account_info(),
            to: ctx.accounts.player_usdc_ata.to_account_info(),
            authority: gs.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, bet.stake)?;

        table.locked_liability = table.locked_liability.saturating_sub(bet.max_total_payout);
        table.active_bets = table.active_bets.saturating_sub(1);
        gs.total_locked_liability = gs.total_locked_liability.saturating_sub(bet.max_total_payout);
        gs.total_active_bets = gs.total_active_bets.saturating_sub(1);

        bet.state = BetState::Refunded;

        Ok(())
    }
}

// -------------------- Accounts --------------------

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub gov_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + Table::SIZE,
        seeds = [b"table", creator.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub table: Account<'info, Table>,


    #[account(
        init,
        payer = creator,
        token::mint = gov_mint,
        token::authority = table,
        seeds = [b"vault_gov", table.key().as_ref()],
        bump
    )]
    pub control_vault_gov: Account<'info, TokenAccount>,

        /// Global state which holds the shared USDC vault
        pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + GlobalState::SIZE,
        seeds = [b"global", usdc_mint.key().as_ref()],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init,
        payer = payer,
        token::mint = usdc_mint,
        token::authority = global_state,
        seeds = [b"global_vault_usdc", global_state.key().as_ref()],
        bump
    )]
    pub global_vault_usdc: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct OnlyOperator<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut, has_one = operator)]
    pub table: Account<'info, Table>,
}

#[derive(Accounts)]
pub struct DepositLiquidityUsdc<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut)]
    pub operator_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, address = global_state.vault_usdc)]
    pub global_vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawLiquidityUsdc<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(mut)]
    pub operator_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut, has_one = operator)]
    pub table: Account<'info, Table>,
    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, address = global_state.vault_usdc)]
    pub global_vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DepositGov<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub depositor_gov_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub table: Account<'info, Table>,

    #[account(mut, address = table.control_vault_gov)]
    pub control_vault_gov: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + GovDeposit::SIZE,
        seeds = [b"gov_deposit", table.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub gov_deposit: Account<'info, GovDeposit>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawGov<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub depositor_gov_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub table: Account<'info, Table>,

    #[account(mut, address = table.control_vault_gov)]
    pub control_vault_gov: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"gov_deposit", table.key().as_ref(), depositor.key().as_ref()],
        bump,
        constraint = gov_deposit.depositor == depositor.key()
    )]
    pub gov_deposit: Account<'info, GovDeposit>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimOperator<'info> {
    #[account(mut)]
    pub table: Account<'info, Table>,
    #[account(
        seeds = [b"gov_deposit", table.key().as_ref(), depositor.key().as_ref()],
        bump,
        constraint = gov_deposit.depositor == depositor.key()
    )]
    pub gov_deposit: Account<'info, GovDeposit>,
    /// CHECK: only for seeds
    pub depositor: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(bet: BetKind, stake: u64, force: [u8; 32])]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub player_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub table: Account<'info, Table>,
    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, address = global_state.vault_usdc)]
    pub global_vault_usdc: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = player,
        space = 8 + BetAccount::SIZE,
        seeds = [b"bet", table.key().as_ref(), player.key().as_ref(), &table.bet_seq.to_le_bytes()],
        bump
    )]
    pub bet: Account<'info, BetAccount>,

    /// CHECK: ORAO VRF randomness account (temporarily unchecked during discriminator fix)
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, &force],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub random: AccountInfo<'info>,

    /// CHECK: treasury (placeholder)
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [CONFIG_ACCOUNT_SEED],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    /// CHECK: ORAO VRF config PDA (validated by seeds::program + seeds). We don't deserialize to avoid layout mismatches.
    pub config: AccountInfo<'info>,

    pub vrf: Program<'info, OraoVrfProgram>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveBet<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(mut)]
    pub table: Account<'info, Table>,
    #[account(mut)]
    pub bet: Account<'info, BetAccount>,

    #[account(mut)]
    pub player_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, address = global_state.vault_usdc)]
    pub global_vault_usdc: Account<'info, TokenAccount>,

    /// CHECK: ORAO randomness request account
    #[account(mut, address = bet.randomness_account)]
    pub random: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundExpiredBet<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut)]
    pub table: Account<'info, Table>,
    #[account(mut)]
    pub bet: Account<'info, BetAccount>,

    #[account(mut)]
    pub player_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, address = global_state.vault_usdc)]
    pub global_vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ORAO program wrapper (Anchor requires type)
#[derive(Clone)]
pub struct OraoVrfProgram;
impl anchor_lang::Id for OraoVrfProgram {
    fn id() -> Pubkey {
        Pubkey::from_str("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y").unwrap()
    }
}

// -------------------- State --------------------

#[account]
pub struct Table {
    pub seed: u64,
    pub creator: Pubkey,
    pub operator: Pubkey,

    pub mode: TableMode,
    pub paused: bool,

    pub usdc_mint: Pubkey,
    pub gov_mint: Pubkey,
    pub global_state: Pubkey,
    pub control_vault_gov: Pubkey,

    pub min_bet: u64,
    pub max_bet: u64,

    pub locked_liability: u64,
    pub active_bets: u32,
    pub bet_seq: u64,

    pub withdraw_request_ts: i64,
    pub withdraw_request_amount: u64,

    pub bumps: TableBumps,
}

impl Table {
    pub const SIZE: usize = 8 + 32 + 32
        + 1 + 1
        + 32 + 32 + 32 + 32
        + 8 + 8
        + 8 + 4 + 8
        + 8 + 8
        + TableBumps::SIZE;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TableMode {
    Private = 0,
    Public = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TableBumps {
    pub table: u8,
    pub control_vault_gov: u8,
}
impl TableBumps {
    pub const SIZE: usize = 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct GlobalBumps {
    pub global: u8,
    pub vault_usdc: u8,
}
impl GlobalBumps {
    pub const SIZE: usize = 1 + 1;
}

#[account]
pub struct GlobalState {
    pub usdc_mint: Pubkey,
    pub vault_usdc: Pubkey,
    pub total_locked_liability: u64,
    pub total_active_bets: u64,
    pub bumps: GlobalBumps,
}
impl GlobalState {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + GlobalBumps::SIZE;
}

#[account]
pub struct GovDeposit {
    pub table: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
}
impl GovDeposit {
    pub const SIZE: usize = 32 + 32 + 8;
}

#[account]
pub struct BetAccount {
    pub table: Pubkey,
    pub player: Pubkey,

    pub stake: u64,
    pub multiplier: u16,
    pub max_total_payout: u64,

    pub kind: BetKind,
    pub state: BetState,

    pub created_ts: i64,
    pub force: [u8; 32],

    pub randomness_account: Pubkey,
    pub result_number: Option<u8>,
}
impl BetAccount {
    pub const SIZE: usize = 32 + 32
        + 8 + 2 + 8
        + BetKind::MAX_SIZE + 1
        + 8 + 32
        + 32 + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum BetState {
    Pending = 0,
    Resolved = 1,
    Refunded = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum BetKind {
    Straight { number: u8 },
    Split { a: u8, b: u8 },
    Street { row: u8 },
    Corner { row: u8, col: u8 },
    SixLine { row: u8 },
    Red,
    Black,
    Even,
    Odd,
    Low,
    High,
    Dozen { idx: u8 },
    Column { idx: u8 },
}
impl BetKind {
    pub const MAX_SIZE: usize = 1 + 2;
}

// -------------------- Helpers --------------------

#[macro_export]
macro_rules! table_signer_seeds {
    ($table:expr) => {{
        &[ &[ b"table", $table.creator.as_ref(), &$table.seed.to_le_bytes(), &[$table.bumps.table] ] ]
    }};
}

fn roulette_number_from_randomness(rnd: &[u8; 64]) -> u8 {
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&rnd[0..16]);
    let x = u128::from_le_bytes(bytes);
    (x % (ROULETTE_MOD as u128)) as u8
}

fn bet_multiplier(b: &BetKind) -> u16 {
    match b {
        BetKind::Straight { .. } => 35,
        BetKind::Split { .. } => 17,
        BetKind::Street { .. } => 11,
        BetKind::Corner { .. } => 8,
        BetKind::SixLine { .. } => 5,
        BetKind::Red | BetKind::Black => 1,
        BetKind::Even | BetKind::Odd => 1,
        BetKind::Low | BetKind::High => 1,
        BetKind::Dozen { .. } => 2,
        BetKind::Column { .. } => 2,
    }
}

fn validate_bet_kind(b: &BetKind) -> Result<()> {
    match b {
        BetKind::Straight { number } => {
            require!(*number <= 36, RouletteError::InvalidNumber);
        }
        BetKind::Split { a, b } => {
            require!(*a <= 36 && *b <= 36 && *a != *b, RouletteError::InvalidSplit);
            require!(*a != 0 && *b != 0, RouletteError::InvalidSplit);
            require!(are_adjacent(*a, *b), RouletteError::InvalidSplit);
        }
        BetKind::Street { row } => {
            require!(*row >= 1 && *row <= 12, RouletteError::InvalidStreet);
        }
        BetKind::Corner { row, col } => {
            require!(*row >= 1 && *row <= 11, RouletteError::InvalidCorner);
            require!(*col >= 1 && *col <= 2, RouletteError::InvalidCorner);
        }
        BetKind::SixLine { row } => {
            require!(*row >= 1 && *row <= 11, RouletteError::InvalidSixLine);
        }
        BetKind::Dozen { idx } => {
            require!(*idx >= 1 && *idx <= 3, RouletteError::InvalidDozen);
        }
        BetKind::Column { idx } => {
            require!(*idx >= 1 && *idx <= 3, RouletteError::InvalidColumn);
        }
        _ => {}
    }
    Ok(())
}

fn are_adjacent(a: u8, b: u8) -> bool {
    let (ra, ca) = num_to_row_col(a);
    let (rb, cb) = num_to_row_col(b);
    if ra == rb && (ca as i8 - cb as i8).abs() == 1 {
        return true;
    }
    if ca == cb && (ra as i16 - rb as i16).abs() == 1 {
        return true;
    }
    false
}

fn num_to_row_col(n: u8) -> (u8, u8) {
    let idx = (n - 1) as u16;
    let row = (idx / 3) as u8 + 1;
    let col = (idx % 3) as u8 + 1;
    (row, col)
}

fn is_red(n: u8) -> bool {
    matches!(
        n,
        1 | 3 | 5 | 7 | 9 | 12 | 14 | 16 | 18 | 19 | 21 | 23 | 25 | 27 | 30 | 32 | 34 | 36
    )
}

fn bet_covers_number(b: &BetKind, n: u8) -> bool {
    match b {
        BetKind::Straight { number } => *number == n,
        BetKind::Split { a, b } => *a == n || *b == n,
        BetKind::Street { row } => {
            if n == 0 { return false; }
            let start = 3 * (*row as u8) - 2;
            n >= start && n <= start + 2
        }
        BetKind::Corner { row, col } => {
            if n == 0 { return false; }
            let tl = ((*row as u16 - 1) * 3 + (*col as u16)) as u8;
            let tr = tl + 1;
            let bl = tl + 3;
            let br = bl + 1;
            n == tl || n == tr || n == bl || n == br
        }
        BetKind::SixLine { row } => {
            if n == 0 { return false; }
            let start = 3 * (*row as u8) - 2;
            n >= start && n <= start + 5
        }
        BetKind::Red => n != 0 && is_red(n),
        BetKind::Black => n != 0 && !is_red(n) && n <= 36,
        BetKind::Even => n != 0 && (n % 2 == 0),
        BetKind::Odd => n != 0 && (n % 2 == 1),
        BetKind::Low => n >= 1 && n <= 18,
        BetKind::High => n >= 19 && n <= 36,
        BetKind::Dozen { idx } => match idx {
            1 => n >= 1 && n <= 12,
            2 => n >= 13 && n <= 24,
            3 => n >= 25 && n <= 36,
            _ => false,
        },
        BetKind::Column { idx } => {
            if n == 0 { return false; }
            let (_r, c) = num_to_row_col(n);
            *idx == c
        }
    }
}

// -------------------- Errors --------------------

#[error_code]
pub enum RouletteError {
    #[msg("Invalid bet range")]
    InvalidBetRange,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Paused")]
    Paused,
    #[msg("Invalid stake")]
    InvalidStake,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient liquidity for this bet")]
    InsufficientLiquidity,

    #[msg("Invalid number")]
    InvalidNumber,
    #[msg("Invalid split")]
    InvalidSplit,
    #[msg("Invalid street")]
    InvalidStreet,
    #[msg("Invalid corner")]
    InvalidCorner,
    #[msg("Invalid six line")]
    InvalidSixLine,
    #[msg("Invalid dozen")]
    InvalidDozen,
    #[msg("Invalid column")]
    InvalidColumn,

    #[msg("Not enough GOV to operate (need >=51 deposited)")]
    NotEnoughGovToOperate,
    #[msg("Insufficient GOV deposit")]
    InsufficientGovDeposit,
    #[msg("Operator cannot reduce GOV deposit below threshold")]
    OperatorCantDropBelowThreshold,

    #[msg("Bet is not pending")]
    BetNotPending,
    #[msg("Bet not expired yet")]
    BetNotExpired,

    #[msg("Randomness account decode failed")]
    RandomnessDecodeFailed,
    #[msg("Randomness not fulfilled yet")]
    RandomnessNotFulfilled,

    #[msg("Active bets exist")]
    ActiveBetsExist,
    #[msg("Liability is locked")]
    LiabilityLocked,

    #[msg("Not in public mode")]
    NotInPublicMode,
    #[msg("Withdraw request mismatch")]
    WithdrawRequestMismatch,
    #[msg("Withdraw delay has not passed yet")]
    WithdrawDelayNotPassed,
}
