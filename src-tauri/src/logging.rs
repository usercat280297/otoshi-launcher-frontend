use std::fs;
use std::path::Path;

use once_cell::sync::OnceCell;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::Subscriber;
use tracing_subscriber::EnvFilter;

use crate::errors::Result;

static LOG_GUARD: OnceCell<WorkerGuard> = OnceCell::new();

pub fn init(log_dir: &Path) -> Result<()> {
    fs::create_dir_all(log_dir)?;

    let file_appender = tracing_appender::rolling::daily(log_dir, "launcher.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let subscriber = Subscriber::builder()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_file(true)
        .with_line_number(true)
        .finish();

    tracing::subscriber::set_global_default(subscriber)
        .map_err(|err| crate::errors::LauncherError::Config(err.to_string()))?;

    Ok(())
}
