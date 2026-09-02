//! YouPet Core workbench integration.

mod ops;
mod schemas;
mod types;

#[cfg(test)]
#[path = "registry/tests.rs"]
mod registry_contract_tests;

pub use ops::*;
pub use schemas::{all_internal_controllers as all_youpet_internal_controllers, youpet_schemas};
pub use types::*;
