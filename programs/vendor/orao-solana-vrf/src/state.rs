use anchor_lang::{prelude::*, AccountDeserialize, Discriminator};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OraoTokenFeeConfig {
    pub treasury: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NetworkConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub token_fee_config: Option<OraoTokenFeeConfig>,
}

#[account]
pub struct NetworkState {
    pub config: NetworkConfig,
}

impl NetworkState {
    pub const SIZE: usize = 8 + 32 + 32 + 9; // approximate
}

/// Response of a single fulfillment authority.
#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Eq)]
pub struct RandomnessResponse {
    pub pubkey: Pubkey,
    pub randomness: [u8; 64],
}

/// Legacy randomness account (V1).
///
/// This exists for backwards compatibility and for observing old requests.
#[account]
#[derive(PartialEq, Eq)]
pub struct Randomness {
    pub seed: [u8; 32],
    pub randomness: [u8; 64],
    pub responses: Vec<RandomnessResponse>,
}

impl Randomness {
    pub const fn fulfilled(&self) -> Option<&[u8; 64]> {
        // V1 uses an all-zero randomness to indicate pending.
        if matches!(
            self.randomness,
            [
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
            ]
        ) {
            None
        } else {
            Some(&self.randomness)
        }
    }
}

/// Pending request representation (V2).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct PendingRequest {
    /// The client created the request.
    pub client: Pubkey,
    /// Request seed.
    pub seed: [u8; 32],
    /// Collected responses so far.
    pub responses: Vec<RandomnessResponse>,
}

/// Fulfilled request representation (V2).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct FulfilledRequest {
    /// The client created the request.
    pub client: Pubkey,
    /// Request seed.
    pub seed: [u8; 32],
    /// Generated randomness.
    pub randomness: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum RequestAccount {
    Pending(PendingRequest),
    Fulfilled(FulfilledRequest),
}

impl RequestAccount {
    pub const fn fulfilled(&self) -> Option<&FulfilledRequest> {
        match self {
            RequestAccount::Pending(_) => None,
            RequestAccount::Fulfilled(ref x) => Some(x),
        }
    }

    pub const fn seed(&self) -> &[u8; 32] {
        match self {
            RequestAccount::Pending(ref x) => &x.seed,
            RequestAccount::Fulfilled(ref x) => &x.seed,
        }
    }

    pub const fn client(&self) -> &Pubkey {
        match self {
            RequestAccount::Pending(ref x) => &x.client,
            RequestAccount::Fulfilled(ref x) => &x.client,
        }
    }

    pub fn responses(&self) -> Option<&[RandomnessResponse]> {
        match self {
            RequestAccount::Pending(ref x) => Some(x.responses.as_slice()),
            RequestAccount::Fulfilled(_) => None,
        }
    }
}

/// Randomness account (V2).
#[account]
#[derive(Eq, PartialEq)]
pub struct RandomnessV2 {
    pub request: RequestAccount,
}

impl RandomnessV2 {
    pub const fn fulfilled(&self) -> Option<&FulfilledRequest> {
        self.request.fulfilled()
    }

    pub fn pending(&self) -> Option<&PendingRequest> {
        match self.request {
            RequestAccount::Pending(ref x) => Some(x),
            RequestAccount::Fulfilled(_) => None,
        }
    }

    pub const fn seed(&self) -> &[u8; 32] {
        self.request.seed()
    }

    pub const fn client(&self) -> &Pubkey {
        self.request.client()
    }
}

/// Data of a supported randomness account.
#[derive(Clone, PartialEq, Eq)]
pub enum RandomnessAccountData {
    V1(Randomness),
    V2(RandomnessV2),
}

impl RandomnessAccountData {
    pub fn fulfilled_randomness(&self) -> Option<[u8; 64]> {
        match self {
            RandomnessAccountData::V1(x) => x.fulfilled().map(|x| *x),
            RandomnessAccountData::V2(x) => x.fulfilled().map(|y| y.randomness),
        }
    }
}

impl AccountDeserialize for RandomnessAccountData {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        let Some(discriminator) = buf.get(..8) else {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        };

        match discriminator {
            Randomness::DISCRIMINATOR => {
                Randomness::try_deserialize_unchecked(buf).map(RandomnessAccountData::V1)
            }
            RandomnessV2::DISCRIMINATOR => {
                RandomnessV2::try_deserialize_unchecked(buf).map(RandomnessAccountData::V2)
            }
            _ => Err(
                anchor_lang::error::Error::from(anchor_lang::error::AnchorError {
                    error_name: anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
                        .name(),
                    error_code_number: anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
                        .into(),
                    error_msg: anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch
                        .to_string(),
                    error_origin: None,
                    compared_values: None,
                })
                .with_account_name("RandomnessAccountData"),
            ),
        }
    }
}
