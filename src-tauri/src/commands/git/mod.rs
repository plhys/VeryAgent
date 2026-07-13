// Auto-generated git module (T1 extraction from folders.rs).
// Allow git submodules to call back into folder commands if needed.
use crate::commands::folders::*;

pub mod clone;
pub mod commit;
pub mod common;
pub mod credential;
pub mod diff;
pub mod merge;
pub mod ops;
pub mod push;
pub mod remote;
pub mod stash;
pub mod types;

pub use clone::*;
pub use commit::*;
pub use credential::*;
pub use diff::*;
pub use merge::*;
pub use ops::*;
pub use push::*;
pub use remote::*;
pub use stash::*;
pub use types::*;
