use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use memmap2::Mmap;
use memmap2::MmapOptions;

#[derive(Clone)]
pub struct FileManager {
    app_data_dir: PathBuf,
    install_dir: PathBuf,
}

impl FileManager {
    pub fn new(app_data_dir: PathBuf, install_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            install_dir,
        }
    }

    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    pub fn install_dir(&self) -> &Path {
        &self.install_dir
    }

    pub fn write_atomic(&self, path: &Path, contents: &[u8]) -> io::Result<()> {
        let temp_path = path.with_extension("tmp");
        if let Some(parent) = temp_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(&temp_path)?;
        use std::io::Write;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(temp_path, path)?;
        Ok(())
    }

    pub fn mmap_read(&self, path: &Path) -> io::Result<Mmap> {
        let file = File::open(path)?;
        unsafe { MmapOptions::new().map(&file) }
    }

    pub fn get_game_dir(&self, game_slug: &str) -> PathBuf {
        self.install_dir.join(game_slug)
    }

    pub fn dir_size(&self, path: &Path) -> io::Result<u64> {
        let mut total = 0;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            if metadata.is_dir() {
                total += self.dir_size(&entry.path())?;
            } else {
                total += metadata.len();
            }
        }
        Ok(total)
    }
}
