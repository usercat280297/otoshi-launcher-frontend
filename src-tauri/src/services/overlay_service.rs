use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct OverlayService {
    state: Arc<Mutex<OverlayState>>,
}

struct OverlayState {
    visible: bool,
    last_capture: Option<PathBuf>,
}

impl OverlayService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(OverlayState {
                visible: false,
                last_capture: None,
            })),
        }
    }

    pub fn toggle(&self) -> bool {
        let mut state = self.state.lock().expect("overlay lock");
        state.visible = !state.visible;
        state.visible
    }

    pub fn set_visible(&self, visible: bool) {
        let mut state = self.state.lock().expect("overlay lock");
        state.visible = visible;
    }

    pub fn is_visible(&self) -> bool {
        let state = self.state.lock().expect("overlay lock");
        state.visible
    }

    pub fn capture_screenshot(&self) -> Result<String, String> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "time error".to_string())?
            .as_secs();
        let filename = format!("overlay-capture-{}.txt", timestamp);
        let path = std::env::temp_dir().join(filename);
        fs::write(&path, b"overlay capture placeholder\n").map_err(|err| err.to_string())?;
        let mut state = self.state.lock().expect("overlay lock");
        state.last_capture = Some(path.clone());
        Ok(path.to_string_lossy().to_string())
    }
}
