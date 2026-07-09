use veryagent::commands::acp::{skill_storage_spec, preferred_scope_skill_dir};
use veryagent::acp::types::AgentSkillScope;
use veryagent::models::agent::AgentType;

fn main() {
    // Check skill_storage_spec for Hermes
    let spec = skill_storage_spec(AgentType::Hermes);
    println!("=== Hermes skill_storage_spec ===");
    match &spec {
        Some(s) => {
            println!("  kind: {:?}, global_dirs: {:?}", s.kind, s.global_dirs);
            for d in &s.global_dirs {
                println!("  dir {} exists={}", d.display(), d.exists());
            }
        }
        None => println!("  None! Hermes is NOT supported"),
    }
    
    // Check preferred_scope_skill_dir
    println!("\n=== preferred_scope_skill_dir(Hermes, Global) ===");
    match preferred_scope_skill_dir(AgentType::Hermes, AgentSkillScope::Global, None) {
        Ok(p) => println!("  {} exists={}", p.display(), p.exists()),
        Err(e) => println!("  ERROR: {:?}", e),
    }
    
    // Also check KimiCode for comparison
    println!("\n=== KimiCode skill_storage_spec ===");
    let spec2 = skill_storage_spec(AgentType::KimiCode);
    match &spec2 {
        Some(s) => {
            for d in &s.global_dirs {
                println!("  dir {} exists={}", d.display(), d.exists());
            }
        }
        None => println!("  None!"),
    }
}
