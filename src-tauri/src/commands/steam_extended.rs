use chrono::DateTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamDLC {
    pub app_id: String,
    pub name: String,
    pub header_image: Option<String>,
    pub description: Option<String>,
    pub release_date: Option<String>,
    pub price: Option<SteamPrice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamPrice {
    pub initial: Option<i64>,
    pub final_price: Option<i64>,
    pub discount_percent: Option<i32>,
    pub currency: Option<String>,
    pub formatted: Option<String>,
    pub final_formatted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievement {
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub icon_gray: Option<String>,
    pub hidden: bool,
    pub global_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamNewsItem {
    pub gid: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub contents: Option<String>,
    pub image: Option<String>,
    pub images: Vec<String>,
    pub feed_label: Option<String>,
    pub date: i64,
    pub feed_name: Option<String>,
    pub tags: Vec<String>,
    pub patch_notes: Option<Vec<NewsPatchNote>>,
    pub structured_content: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsPatchNote {
    pub title: String,
    pub content: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamReviewSummary {
    pub total_positive: i64,
    pub total_negative: i64,
    pub total_reviews: i64,
    pub review_score: i32,
    pub review_score_desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamExtendedData {
    pub app_id: String,
    pub dlc: SteamDLCList,
    pub achievements: SteamAchievementList,
    pub news: SteamNewsList,
    pub player_count: Option<i64>,
    pub reviews: SteamReviewSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamDLCList {
    pub items: Vec<SteamDLC>,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAchievementList {
    pub items: Vec<SteamAchievement>,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamNewsList {
    pub items: Vec<SteamNewsItem>,
    pub total: i32,
}

/// Fetch extended Steam game data (DLC, achievements, news, reviews)
#[tauri::command]
pub async fn fetch_steam_extended(app_id: String) -> Result<SteamExtendedData, String> {
    let api_base =
        std::env::var("LAUNCHER_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());
    let url = format!(
        "{}/steam/games/{}/extended?news_all=true",
        api_base.trim_end_matches('/'),
        app_id
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let mut news = parse_news_list(&data["news"]);

    // Prefer the first image when only images[] is available.
    for item in news.items.iter_mut() {
        if item.image.is_none() && !item.images.is_empty() {
            item.image = Some(item.images[0].clone());
        }
    }

    // Attempt to fill missing images via Steam RSS (matches Steam client thumbnails).
    if news
        .items
        .iter()
        .any(|item| item.image.is_none() || item.contents.as_deref().unwrap_or("").len() < 400)
    {
        if let Some(rss_entries) = fetch_rss_entries(&app_id).await {
            for item in news.items.iter_mut() {
                let is_community = is_community_item(item);
                if let Some(entry) = match_rss_entry(&item.title, item.date, &rss_entries) {
                    let mut contents_changed = false;
                    if is_community {
                        // Prefer RSS enclosure image for community announcements (Steam client style).
                        item.image = Some(entry.image.clone());
                        let mut merged = Vec::new();
                        merged.push(entry.image.clone());
                        for img in item.images.iter() {
                            if img != &entry.image {
                                merged.push(img.clone());
                            }
                        }
                        item.images = merged;
                    } else if item.image.is_none() {
                        item.image = Some(entry.image.clone());
                        if item.images.is_empty() {
                            item.images.push(entry.image.clone());
                        }
                    }
                    let current_len = item.contents.as_deref().unwrap_or("").len();
                    if !entry.description.is_empty() && entry.description.len() > current_len {
                        item.contents = Some(entry.description.clone());
                        contents_changed = true;
                    }
                    if item.url.is_empty() && !entry.url.is_empty() {
                        item.url = entry.url.clone();
                    }
                    if contents_changed {
                        // Drop stale structured content to allow frontend to re-parse from contents.
                        item.structured_content = None;
                    }
                }
            }
        }
    }

    // Final fallback: use app header image if everything else is missing.
    if news.items.iter().any(|item| item.image.is_none()) {
        if let Some(fallback) = fetch_app_header_image(&app_id).await {
            for item in news.items.iter_mut() {
                if item.image.is_none() {
                    item.image = Some(fallback.clone());
                    if item.images.is_empty() {
                        item.images.push(fallback.clone());
                    }
                }
            }
        }
    }

    let mut dlc = parse_dlc_list(&data["dlc"]);
    enrich_dlc_images(&mut dlc.items).await;

    Ok(SteamExtendedData {
        app_id: data["app_id"].as_str().unwrap_or(&app_id).to_string(),
        dlc,
        achievements: parse_achievement_list(&data["achievements"]),
        news,
        player_count: data["player_count"].as_i64(),
        reviews: parse_review_summary(&data["reviews"]),
    })
}

async fn fetch_app_header_image(app_id: &str) -> Option<String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en&filters=basic",
        app_id
    );
    let response = reqwest::get(&url).await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let data: serde_json::Value = response.json().await.ok()?;
    let entry = data.get(app_id)?;
    let app_data = entry.get("data")?;
    app_data
        .get("header_image")
        .or_else(|| app_data.get("capsule_image"))
        .or_else(|| app_data.get("background"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

async fn enrich_dlc_images(items: &mut Vec<SteamDLC>) {
    let mut remaining = 8;
    for item in items.iter_mut() {
        if remaining == 0 {
            break;
        }
        if item.header_image.is_some() && item.description.is_some() {
            continue;
        }
        if let Some(meta) = fetch_store_meta(&item.app_id).await {
            if item.header_image.is_none() {
                item.header_image = meta.image.clone();
            }
            if item.name.starts_with("DLC ") {
                if let Some(title) = meta.title {
                    let cleaned = title.replace(" on Steam", "").trim().to_string();
                    if !cleaned.is_empty() {
                        item.name = cleaned;
                    }
                }
            }
            if item.description.is_none() {
                item.description = meta.description;
            }
        }
        remaining -= 1;
    }
}

struct StoreMeta {
    image: Option<String>,
    title: Option<String>,
    description: Option<String>,
}

async fn fetch_store_meta(app_id: &str) -> Option<StoreMeta> {
    let url = format!("https://store.steampowered.com/app/{}/?l=en", app_id);
    let response = reqwest::get(&url).await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let html = response.text().await.ok()?;
    Some(StoreMeta {
        image: extract_meta(&html, "og:image").or_else(|| extract_meta(&html, "twitter:image")),
        title: extract_meta(&html, "og:title"),
        description: extract_meta(&html, "og:description"),
    })
}

fn extract_meta(html: &str, key: &str) -> Option<String> {
    let prop_pattern = format!("property=\"{}\"", key);
    if let Some(found) = html.find(&prop_pattern) {
        if let Some(content) = extract_meta_content(&html[found..]) {
            return Some(content);
        }
    }
    let name_pattern = format!("name=\"{}\"", key);
    if let Some(found) = html.find(&name_pattern) {
        if let Some(content) = extract_meta_content(&html[found..]) {
            return Some(content);
        }
    }
    None
}

fn extract_meta_content(fragment: &str) -> Option<String> {
    let content_key = "content=\"";
    let start = fragment.find(content_key)? + content_key.len();
    let rest = &fragment[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[derive(Debug, Clone)]
struct RssEntry {
    title: String,
    image: String,
    description: String,
    url: String,
    date: i64,
}

async fn fetch_rss_entries(app_id: &str) -> Option<Vec<RssEntry>> {
    let url = format!(
        "https://store.steampowered.com/feeds/news/app/{}?l=english",
        app_id
    );
    let response = reqwest::get(&url).await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.text().await.ok()?;
    let mut items = Vec::new();
    let mut cursor = 0;
    while let Some(rel_start) = body[cursor..].find("<item>") {
        let item_start = cursor + rel_start + "<item>".len();
        let rel_end = match body[item_start..].find("</item>") {
            Some(end) => end,
            None => break,
        };
        let item_end = item_start + rel_end;
        let item_block = &body[item_start..item_end];
        cursor = item_end + "</item>".len();

        let title = extract_tag(item_block, "title")
            .map(unescape_html)
            .unwrap_or_default();
        let image = extract_enclosure_url(item_block).unwrap_or_default();
        let description = extract_tag(item_block, "description")
            .map(unescape_html)
            .unwrap_or_default();
        let url = extract_tag(item_block, "link")
            .or_else(|| extract_tag(item_block, "guid"))
            .map(unescape_html)
            .unwrap_or_default();
        let date = extract_tag(item_block, "pubDate")
            .and_then(|value| DateTime::parse_from_rfc2822(value.trim()).ok())
            .map(|dt| dt.timestamp())
            .unwrap_or(0);
        if !title.is_empty() && !image.is_empty() {
            items.push(RssEntry {
                title,
                image,
                description,
                url,
                date,
            });
        }
    }

    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

fn extract_tag(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim().to_string())
}

fn extract_enclosure_url(block: &str) -> Option<String> {
    let idx = block.find("<enclosure")?;
    let slice = &block[idx..];
    let url_key = "url=\"";
    let url_start = slice.find(url_key)? + url_key.len();
    let url_end = slice[url_start..].find('"')? + url_start;
    Some(slice[url_start..url_end].to_string())
}

fn unescape_html(input: String) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn normalize_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    for ch in title.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

fn match_rss_entry(title: &str, date: i64, rss: &[RssEntry]) -> Option<RssEntry> {
    let norm_title = normalize_title(title);
    if norm_title.is_empty() {
        return None;
    }
    for entry in rss.iter() {
        if normalize_title(&entry.title) == norm_title {
            return Some(entry.clone());
        }
    }
    for entry in rss.iter() {
        let norm_rss = normalize_title(&entry.title);
        if norm_rss.is_empty() {
            continue;
        }
        if norm_title.contains(&norm_rss) || norm_rss.contains(&norm_title) {
            return Some(entry.clone());
        }
    }
    if date > 0 {
        let mut best: Option<&RssEntry> = None;
        let mut best_delta = i64::MAX;
        for entry in rss.iter() {
            if entry.date <= 0 {
                continue;
            }
            let delta = (entry.date - date).abs();
            if delta < best_delta {
                best_delta = delta;
                best = Some(entry);
            }
        }
        if let Some(entry) = best {
            if best_delta <= 14 * 86400 {
                return Some(entry.clone());
            }
        }
    }
    None
}

fn is_community_item(item: &SteamNewsItem) -> bool {
    if let Some(name) = item.feed_name.as_deref() {
        if name.eq_ignore_ascii_case("steam_community_announcements") {
            return true;
        }
    }
    if let Some(label) = item.feed_label.as_deref() {
        let lower = label.to_lowercase();
        if lower.contains("community") {
            return true;
        }
    }
    false
}

fn parse_dlc_list(data: &serde_json::Value) -> SteamDLCList {
    let items: Vec<SteamDLC> = data["items"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(SteamDLC {
                        app_id: item["app_id"].as_str()?.to_string(),
                        name: item["name"].as_str().unwrap_or("Unknown").to_string(),
                        header_image: item["header_image"].as_str().map(String::from),
                        description: item["description"]
                            .as_str()
                            .or(item["short_description"].as_str())
                            .map(String::from),
                        release_date: item["release_date"].as_str().map(String::from),
                        price: parse_price(&item["price"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    SteamDLCList {
        total: items.len() as i32,
        items,
    }
}

fn parse_achievement_list(data: &serde_json::Value) -> SteamAchievementList {
    let items: Vec<SteamAchievement> = data["items"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(SteamAchievement {
                        name: item["name"].as_str()?.to_string(),
                        display_name: item["display_name"]
                            .as_str()
                            .or(item["displayName"].as_str())
                            .unwrap_or("Unknown")
                            .to_string(),
                        description: item["description"].as_str().map(String::from),
                        icon: item["icon"].as_str().map(String::from),
                        icon_gray: item["icon_gray"]
                            .as_str()
                            .or(item["iconGray"].as_str())
                            .map(String::from),
                        hidden: item["hidden"].as_bool().unwrap_or(false),
                        global_percent: item["global_percent"]
                            .as_f64()
                            .or(item["globalPercent"].as_f64()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    SteamAchievementList {
        total: items.len() as i32,
        items,
    }
}

fn parse_news_list(data: &serde_json::Value) -> SteamNewsList {
    let items: Vec<SteamNewsItem> = data["items"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(SteamNewsItem {
                        gid: item["gid"].as_str()?.to_string(),
                        title: item["title"].as_str().unwrap_or("").to_string(),
                        url: item["url"].as_str().unwrap_or("").to_string(),
                        author: item["author"].as_str().map(String::from),
                        contents: item["contents"].as_str().map(String::from),
                        image: item["image"].as_str().map(String::from),
                        images: item["images"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        patch_notes: item["patch_notes"].as_array().map(|arr| {
                            arr.iter()
                                .filter_map(|note| {
                                    Some(NewsPatchNote {
                                        title: note["title"].as_str()?.to_string(),
                                        content: note["content"].as_str()?.to_string(),
                                        category: note["category"]
                                            .as_str()
                                            .unwrap_or("General")
                                            .to_string(),
                                    })
                                })
                                .collect()
                        }),
                        structured_content: item.get("structured_content").cloned(),
                        feed_label: item["feed_label"]
                            .as_str()
                            .or(item["feedLabel"].as_str())
                            .map(String::from),
                        date: item["date"].as_i64().unwrap_or(0),
                        feed_name: item["feed_name"]
                            .as_str()
                            .or(item["feedName"].as_str())
                            .map(String::from),
                        tags: item["tags"]
                            .as_array()
                            .map(|t| {
                                t.iter()
                                    .filter_map(|v| v.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    SteamNewsList {
        total: items.len() as i32,
        items,
    }
}

fn parse_review_summary(data: &serde_json::Value) -> SteamReviewSummary {
    SteamReviewSummary {
        total_positive: data["total_positive"]
            .as_i64()
            .or(data["totalPositive"].as_i64())
            .unwrap_or(0),
        total_negative: data["total_negative"]
            .as_i64()
            .or(data["totalNegative"].as_i64())
            .unwrap_or(0),
        total_reviews: data["total_reviews"]
            .as_i64()
            .or(data["totalReviews"].as_i64())
            .unwrap_or(0),
        review_score: data["review_score"]
            .as_i64()
            .or(data["reviewScore"].as_i64())
            .unwrap_or(0) as i32,
        review_score_desc: data["review_score_desc"]
            .as_str()
            .or(data["reviewScoreDesc"].as_str())
            .unwrap_or("No reviews")
            .to_string(),
    }
}

fn parse_price(data: &serde_json::Value) -> Option<SteamPrice> {
    if data.is_null() {
        return None;
    }

    Some(SteamPrice {
        initial: data["initial"].as_i64(),
        final_price: data["final"].as_i64(),
        discount_percent: data["discount_percent"]
            .as_i64()
            .or(data["discountPercent"].as_i64())
            .map(|v| v as i32),
        currency: data["currency"].as_str().map(String::from),
        formatted: data["formatted"].as_str().map(String::from),
        final_formatted: data["final_formatted"]
            .as_str()
            .or(data["finalFormatted"].as_str())
            .map(String::from),
    })
}
