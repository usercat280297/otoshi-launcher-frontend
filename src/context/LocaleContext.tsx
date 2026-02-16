import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchLocaleBundle, fetchLocaleSettings, updateLocaleSettings } from "../services/api";

type Locale = "en" | "vi";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (value: Locale) => void;
  t: (key: string) => string;
  options: Array<{ value: Locale; label: string; shortLabel: string }>;
};

const LOCALE_STORAGE_KEY = "otoshi_locale";
const LOCALE_BUNDLE_CACHE_PREFIX = "otoshi_locale_bundle_";

const messages: Record<string, Record<Locale, string>> = {
  // Navigation - Top bar
  "nav.store": { en: "Store", vi: "Cửa hàng" },
  "nav.support": { en: "Support", vi: "Hỗ trợ" },
  "nav.distribute": { en: "Distribute", vi: "Phân phối" },

  // Actions
  "action.sign_in": { en: "Sign in", vi: "Đăng nhập" },
  "action.sign_out": { en: "Sign out", vi: "Đăng xuất" },
  "action.download": { en: "Download", vi: "Tải về" },
  "action.download_launcher": { en: "Download Launcher", vi: "Tải Launcher" },
  "action.language": { en: "Language", vi: "Ngôn ngữ" },
  "action.save": { en: "Save", vi: "Lưu" },
  "action.cancel": { en: "Cancel", vi: "Hủy" },
  "action.delete": { en: "Delete", vi: "Xóa" },
  "action.edit": { en: "Edit", vi: "Chỉnh sửa" },
  "action.search": { en: "Search", vi: "Tìm kiếm" },
  "action.play": { en: "Play", vi: "Chơi" },
  "action.stop": { en: "Stop", vi: "Dừng" },
  "action.install": { en: "Install", vi: "Cài đặt" },
  "action.uninstall": { en: "Uninstall", vi: "Gỡ cài đặt" },
  "action.pause": { en: "Pause", vi: "Tạm dừng" },
  "action.resume": { en: "Resume", vi: "Tiếp tục" },
  "action.learn_more": { en: "Learn More", vi: "Tìm hiểu thêm" },
  "action.save_now": { en: "Save Now", vi: "Lưu ngay" },

  // Locale options
  "locale.english": { en: "English", vi: "Tiếng Anh" },
  "locale.vietnamese": { en: "Vietnamese", vi: "Tiếng Việt" },

  // Sidebar sections
  "sidebar.launcher": { en: "Launcher", vi: "Trình khởi chạy" },
  "sidebar.play": { en: "Play", vi: "Chơi" },
  "sidebar.discover": { en: "Anime", vi: "Anime" },
  "sidebar.fixes": { en: "Fixes", vi: "Sửa lỗi" },
  "sidebar.create": { en: "Create", vi: "Tạo" },
  "sidebar.active_download": { en: "Active download", vi: "Đang tải xuống" },
  "sidebar.active_game": { en: "Active game", vi: "Game đang chạy" },
  "sidebar.no_downloads": { en: "No active downloads.", vi: "Không có tải xuống nào." },
  "sidebar.paused": { en: "Paused", vi: "Tam dung" },
  "sidebar.bandwidth": { en: "Bandwidth", vi: "Bang thong" },
  "sidebar.download_manager": { en: "Download Manager", vi: "Quan ly tai xuong" },

  // Top bar
  "topbar.guided_tour": { en: "Guided tour", vi: "Huong dan" },
  "topbar.window.minimize": { en: "Minimize", vi: "Thu nho" },
  "topbar.window.maximize": { en: "Maximize", vi: "Phong to" },
  "topbar.theme.switch_light": { en: "Switch to light mode", vi: "Chuyen sang che do sang" },
  "topbar.theme.switch_dark": { en: "Switch to dark mode", vi: "Chuyen sang che do toi" },
  "topbar.theme.light": { en: "Light mode", vi: "Che do sang" },
  "topbar.theme.dark": { en: "Dark mode", vi: "Che do toi" },

  // Support Modal
  "support.title": { en: "Community Support", vi: "Góc Hỗ Trợ" },
  "support.subtitle": { en: "Get help 24/7", vi: "Hỗ trợ 24/7" },
  "support.close": { en: "Close", vi: "Đóng" },
  "support.description": {
    en: "Questions? Join the channel here to get answers, gooners !!",
    vi: "Thắc mắc? Vô kênh mình tại đây để được giải đáp nhé các gooner !!",
  },
  "support.join_discord": { en: "Join Discord Server", vi: "Tham gia Discord" },

  // Sidebar navigation items
  "nav.library": { en: "Library", vi: "Thư viện" },
  "nav.downloads": { en: "Downloads", vi: "Tải xuống" },
  "nav.big_picture": { en: "Big Picture", vi: "Chế độ toàn màn hình" },
  "nav.discover": { en: "Anime", vi: "Anime" },
  "nav.wishlist": { en: "Wishlist", vi: "Danh sách yêu thích" },
  "nav.community": { en: "Community", vi: "Cộng đồng" },
  "nav.workshop": { en: "Workshop", vi: "Xưởng sáng tạo" },
  "nav.online_fix": { en: "Online Fix", vi: "Sửa lỗi Online" },
  "nav.bypass": { en: "Bypass", vi: "Bỏ qua bảo vệ" },
  "nav.developer": { en: "Developer", vi: "Nhà phát triển" },
  "nav.inventory": { en: "Inventory", vi: "Kho đồ" },
  "nav.settings": { en: "Settings", vi: "Cài đặt" },

  // Library
  "library.playtime_played": { en: "{hours}h played", vi: "{hours}h đã chơi" },
  "library.status.installed": { en: "Installed", vi: "Đã cài đặt" },
  "library.status.not_installed": { en: "Not installed", vi: "Chưa cài đặt" },

  // Store page
  "store.featured": { en: "Featured Spotlight", vi: "Tựa game nổi bật" },
  "store.discover_new": { en: "Discover Something New", vi: "Khám phá điều mới mẻ" },
  "store.top_picks": { en: "Top Picks", vi: "Lựa chọn hàng đầu" },
  "store.this_week": { en: "This Week", vi: "Tuần này" },
  "store.browse": { en: "Game", vi: "Game" },
  "store.news": { en: "News", vi: "Tin tức" },
  "store.steam_vault": { en: "Steam Vault", vi: "Kho Steam" },

  // Game details
  "game.description": { en: "Description", vi: "Mô tả" },
  "game.requirements": { en: "Requirements", vi: "Yêu cầu hệ thống" },
  "game.minimum": { en: "Minimum", vi: "Tối thiểu" },
  "game.recommended": { en: "Recommended", vi: "Đề xuất" },
  "game.reviews": { en: "Reviews", vi: "Đánh giá" },
  "game.similar": { en: "Similar Games", vi: "Game tương tự" },
  "game.dlc": { en: "DLC", vi: "Nội dung bổ sung" },
  "game.achievements": { en: "Achievements", vi: "Thành tựu" },
  "media.loading_video": { en: "Loading video...", vi: "Đang tải video..." },
  "media.loading_image": { en: "Loading image...", vi: "Đang tải ảnh..." },

  // Downloads
  "download.status.pending": { en: "Pending", vi: "Đang chờ" },
  "download.status.downloading": { en: "Downloading", vi: "Đang tải" },
  "download.status.paused": { en: "Paused", vi: "Đã tạm dừng" },
  "download.status.completed": { en: "Completed", vi: "Hoàn tất" },
  "download.status.failed": { en: "Failed", vi: "Thất bại" },
  "download.status.verifying": { en: "Verifying", vi: "Đang xác minh" },

  // Settings
  "settings.general": { en: "General", vi: "Chung" },
  "settings.downloads": { en: "Downloads", vi: "Tải xuống" },
  "settings.appearance": { en: "Appearance", vi: "Giao diện" },
  "settings.notifications": { en: "Notifications", vi: "Thông báo" },
  "settings.privacy": { en: "Privacy", vi: "Quyền riêng tư" },
  "settings.about": { en: "About", vi: "Giới thiệu" },

  // Common
  "common.loading": { en: "Loading...", vi: "Đang tải..." },
  "common.game": { en: "Game", vi: "Game" },
  "common.error": { en: "Error", vi: "Lỗi" },
  "common.success": { en: "Success", vi: "Thành công" },
  "common.warning": { en: "Warning", vi: "Cảnh báo" },
  "common.confirm": { en: "Confirm", vi: "Xác nhận" },
  "common.close": { en: "Close", vi: "Đóng" },
  "common.dismiss": { en: "Dismiss", vi: "Dong" },
  "common.browse": { en: "Browse", vi: "Duyet" },
  "common.back": { en: "Back", vi: "Quay lại" },
  "common.next": { en: "Next", vi: "Tiếp theo" },
  "common.previous": { en: "Previous", vi: "Trước đó" },
  "common.all": { en: "All", vi: "Tất cả" },
  "common.none": { en: "None", vi: "Không có" },
  "pagination.page": { en: "Page", vi: "Trang" },
  "pagination.go": { en: "Go", vi: "Di" },
  "common.free": { en: "Free", vi: "Miễn phí" },
  "common.price": { en: "Price", vi: "Giá" },
  "common.discord": { en: "Discord", vi: "Discord" },

  // Lua games missing
  "lua.error.title": { en: "Oh no!", vi: "Ôi không!" },
  "lua.error.body": {
    en: "No Lua games found. Please make sure the backend is running on port 8000 and your lua files are available.",
    vi: "Không tìm thấy game Lua. Vui lòng kiểm tra backend đang chạy cổng 8000 và lua files sẵn sàng."
  },
  "lua.error.retry": { en: "Retry", vi: "Thử lại" },

  // Auth
  "auth.login": { en: "Login", vi: "Đăng nhập" },
  "auth.register": { en: "Register", vi: "Đăng ký" },
  "auth.forgot_password": { en: "Forgot Password?", vi: "Quên mật khẩu?" },
  "auth.email": { en: "Email", vi: "Email" },
  "auth.password": { en: "Password", vi: "Mật khẩu" },
  "auth.username": { en: "Username", vi: "Tên người dùng" },
  "auth.continue_with": { en: "Or continue with", vi: "Hoặc tiếp tục với" },
  "auth.create_account": { en: "Create account", vi: "Tao tai khoan" },
  "auth.display_name": { en: "Display name", vi: "Ten hien thi" },
  "auth.login_subtitle": { en: "Access your library, downloads, and cloud saves.", vi: "Truy cap thu vien, tai xuong va cloud save cua ban." },
  "auth.register_subtitle": { en: "Join Otoshi to sync purchases and downloads.", vi: "Tham gia Otoshi de dong bo mua hang va tai xuong." },
  "auth.or_use_email": { en: "or use email", vi: "hoac dung email" },
  "auth.or_create_with_email": { en: "or create with email", vi: "hoac tao bang email" },
  "auth.signing_in": { en: "Signing in...", vi: "Dang dang nhap..." },
  "auth.creating_account": { en: "Creating account...", vi: "Dang tao tai khoan..." },
  "auth.no_account": { en: "No account?", vi: "Chua co tai khoan?" },
  "auth.create_one": { en: "Create one", vi: "Tao moi" },
  "auth.already_have_account": { en: "Already have an account?", vi: "Da co tai khoan?" },
  "auth.error.unable_sign_in": { en: "Unable to sign in", vi: "Khong the dang nhap" },
  "auth.error.unable_create_account": { en: "Unable to create account", vi: "Khong the tao tai khoan" },
  "auth.oauth_missing_code": { en: "Missing OAuth code. Please try again.", vi: "Thieu ma OAuth. Vui long thu lai." },
  "auth.oauth_unable_complete_sign_in": { en: "Unable to complete sign-in.", vi: "Khong the hoan tat dang nhap." },
  "auth.oauth_signing_you_in": { en: "Signing you in", vi: "Dang dang nhap cho ban" },
  "auth.oauth_finishing_connection": { en: "We are finishing your account connection.", vi: "Dang hoan tat ket noi tai khoan cua ban." },
  "auth.oauth_connecting": { en: "Connecting to Otoshi...", vi: "Dang ket noi den Otoshi..." },
  "auth.oauth_provider_not_configured": { en: "Provider is not configured on this build:", vi: "Provider chua duoc cau hinh tren ban build nay:" },
  "auth.oauth_login_timeout": { en: "Login timed out. Please try again.", vi: "Dang nhap het thoi gian. Vui long thu lai." },
  "auth.oauth_failed_start_login": { en: "Failed to start login", vi: "Khong the bat dau dang nhap" },
  "auth.oauth_not_configured": { en: "Not configured", vi: "Chua cau hinh" },
  "auth.oauth_check_browser": { en: "Check your browser to complete login...", vi: "Kiem tra trinh duyet de hoan tat dang nhap..." },
  "auth.oauth_connecting_short": { en: "Connecting...", vi: "Dang ket noi..." },

  // Store page specific
  "store.all_games": { en: "All Games", vi: "Tất cả game" },
  "store.titles_count": { en: "titles", vi: "tựa game" },
  "store.loading_catalog": { en: "Loading catalog", vi: "Đang tải danh mục" },
  "store.loading_more": { en: "Loading more...", vi: "Đang tải thêm..." },
  "store.load_more": { en: "Load more", vi: "Tải thêm" },
  "store.all_loaded": { en: "All games loaded.", vi: "Đã tải tất cả game." },
  "store.api_offline": { en: "API offline, showing local catalog snapshot.", vi: "API không khả dụng, hiển thị dữ liệu cục bộ." },
  "store.syncing": { en: "Syncing catalog...", vi: "Đang đồng bộ danh mục..." },
  "store.top_sellers": { en: "Top Sellers", vi: "Bán chạy nhất" },
  "store.most_played": { en: "Most Played", vi: "Chơi nhiều nhất" },
  "store.top_wishlisted": { en: "Top Upcoming Wishlisted", vi: "Được yêu thích nhất" },
  "store.epic_savings": { en: "Epic Savings Spotlight", vi: "Ưu đãi đặc biệt" },
  "store.sales_specials": { en: "Sales & Specials", vi: "Khuyến mãi & Ưu đãi" },
  "store.free_games": { en: "Free Games", vi: "Game miễn phí" },
  "store.apps": { en: "Apps", vi: "Ứng dụng" },

  // Download Launcher Page
  "launcher.badge": { en: "New Version Available", vi: "Phiên bản mới" },
  "launcher.hero.title": { en: "Otoshi Launcher", vi: "Otoshi Launcher" },
  "launcher.hero.subtitle": {
    en: "Your ultimate gaming hub. Access thousands of games, lightning-fast downloads, cloud saves, and a vibrant community — all in one place.",
    vi: "Trung tâm gaming của bạn. Truy cập hàng nghìn game, tải xuống siêu nhanh, lưu đám mây, và cộng đồng sôi động — tất cả trong một.",
  },
  "launcher.download.button": { en: "Download Launcher", vi: "Tải Launcher" },
  "launcher.download.complete": { en: "Download Complete!", vi: "Tải xong!" },
  "launcher.requirements": { en: "Windows 10/11 • 64-bit • ~150MB", vi: "Windows 10/11 • 64-bit • ~150MB" },
  "launcher.features.title": { en: "Everything You Need to Play", vi: "Tất Cả Những Gì Bạn Cần" },
  "launcher.features.subtitle": {
    en: "Discover powerful features designed to enhance your gaming experience.",
    vi: "Khám phá các tính năng mạnh mẽ được thiết kế để nâng cao trải nghiệm gaming.",
  },
  "launcher.feature.library.title": { en: "Massive Game Library", vi: "Thư Viện Game Khổng Lồ" },
  "launcher.feature.library.desc": {
    en: "Access over 50,000 games from AAA blockbusters to indie gems, all in one place.",
    vi: "Truy cập hơn 50,000 game từ bom tấn AAA đến indie, tất cả ở một nơi.",
  },
  "launcher.feature.fast.title": { en: "Lightning Fast Downloads", vi: "Tải Xuống Siêu Nhanh" },
  "launcher.feature.fast.desc": {
    en: "Multi-threaded downloads with smart CDN selection. Get your games faster than ever.",
    vi: "Tải đa luồng với lựa chọn CDN thông minh. Nhận game nhanh hơn bao giờ hết.",
  },
  "launcher.feature.cloud.title": { en: "Cloud Saves", vi: "Lưu Đám Mây" },
  "launcher.feature.cloud.desc": {
    en: "Your progress is always safe. Play on any device and pick up right where you left off.",
    vi: "Tiến trình của bạn luôn an toàn. Chơi trên mọi thiết bị và tiếp tục ngay từ nơi bạn dừng lại.",
  },
  "launcher.feature.mods.title": { en: "Mod Support", vi: "Hỗ Trợ Mod" },
  "launcher.feature.mods.desc": {
    en: "Easy one-click mod installation. Enhance your games with community-created content.",
    vi: "Cài đặt mod một chạm dễ dàng. Nâng cấp game với nội dung từ cộng đồng.",
  },
  "launcher.feature.community.title": { en: "Active Community", vi: "Cộng Đồng Sôi Động" },
  "launcher.feature.community.desc": {
    en: "Connect with millions of gamers. Share screenshots, guides, and join discussions.",
    vi: "Kết nối với hàng triệu gamers. Chia sẻ ảnh chụp, hướng dẫn, và tham gia thảo luận.",
  },
  "launcher.feature.secure.title": { en: "Safe & Secure", vi: "An Toàn & Bảo Mật" },
  "launcher.feature.secure.desc": {
    en: "Verified game files and secure transactions. Your account and games are protected.",
    vi: "File game được xác minh và giao dịch an toàn. Tài khoản và game của bạn được bảo vệ.",
  },
  "launcher.games.title": { en: "Popular Games", vi: "Game Phổ Biến" },
  "launcher.games.subtitle": { en: "Play the hottest titles right now", vi: "Chơi những tựa game hot nhất ngay bây giờ" },
  "launcher.games.browse": { en: "Browse All Games", vi: "Xem Tất Cả Game" },
  "launcher.showcase.title": { en: "Explore More Titles", vi: "Khám Phá Thêm" },
  "launcher.showcase.subtitle": { en: "", vi: "" },
  "launcher.stats.games": { en: "Games Available", vi: "Game có sẵn" },
  "launcher.stats.users": { en: "Active Users", vi: "Người dùng" },
  "launcher.stats.uptime": { en: "Uptime", vi: "Hoạt động" },
  "launcher.stats.support": { en: "Support", vi: "Hỗ trợ" },
  "launcher.cta.title": { en: "Ready to Play?", vi: "Sẵn Sàng Chơi?" },
  "launcher.cta.subtitle": {
    en: "Join millions of gamers using Otoshi Launcher. Download now and start your adventure!",
    vi: "Tham gia cùng hàng triệu gamers sử dụng Otoshi Launcher. Tải ngay và bắt đầu cuộc phiêu lưu!",
  },
  "launcher.footer.copyright": { en: "© 2026 Otoshi Launcher. All rights reserved.", vi: "© 2026 Otoshi Launcher. Đã đăng ký mọi quyền." },
  "store.spotlight": { en: "Spotlight", vi: "Nổi bật" },
  "store.base_game": { en: "Base Game", vi: "Game gốc" },
  "store.play_now": { en: "Play now", vi: "Chơi ngay" },
  "store.save_big": { en: "Save big on top titles and hidden gems.", vi: "Tiết kiệm lớn với các tựa game hàng đầu." },
  "store.explore_free": { en: "Explore free-to-play hits and weekly drops.", vi: "Khám phá game miễn phí và phát hành hàng tuần." },
  "store.creative_tools": { en: "Creative tools and companion experiences.", vi: "Công cụ sáng tạo và trải nghiệm đồng hành." },
  "store.search_placeholder": { en: "Search name or appid", vi: "Tìm tên hoặc mã game" },

  // Search
  "search.results": { en: "Results", vi: "Kết quả" },
  "search.recent": { en: "Recent searches", vi: "Tìm kiếm gần đây" },
  "search.popular": { en: "Popular now", vi: "Phổ biến hiện tại" },
  "search.no_results": { en: "No results found", vi: "Không tìm thấy kết quả" },

  // Library / Intro / Discover
  "library.search_placeholder": { en: "Search your library", vi: "Tim trong thu vien" },
  "library.filters": { en: "Filters", vi: "Bo loc" },
  "intro.skip": { en: "Skip intro", vi: "Bo qua intro" },
  "intro.launcher": { en: "Launcher", vi: "Launcher" },
  "discover.search_placeholder": { en: "Search anime title", vi: "Tìm tên anime" },
  "discover.anime": { en: "Anime", vi: "Anime" },
  "discover.tags_title": { en: "Anime Tags", vi: "Thẻ Anime" },
  "discover.carousel_label": { en: "Anime Carousel", vi: "Anime Carousel" },
  "discover.hero_fallback_title": { en: "Anime Library", vi: "Thư viện Anime" },
  "discover.hero_fallback_desc": {
    en: "Anime feed with categories, detail metadata, episodes, and server groups. This launcher shows source metadata only.",
    vi: "Nguồn anime với thể loại, metadata, tập và nhóm server. Launcher chỉ hiển thị metadata của nguồn.",
  },
  "discover.score_prefix": { en: "Score", vi: "Điểm" },
  "discover.searching": { en: "Searching...", vi: "Đang tìm..." },
  "discover.open_detail": { en: "Open detail", vi: "Mở chi tiết" },
  "discover.open_source_page": { en: "Open source page", vi: "Mở trang nguồn" },
  "discover.refresh_feed": { en: "Refresh feed", vi: "Làm mới" },
  "discover.trending_now": { en: "Trending now", vi: "Đang thịnh hành" },
  "discover.loading_catalog": { en: "Loading anime catalog...", vi: "Đang tải danh mục anime..." },
  "discover.items": { en: "items", vi: "mục" },
  "discover.detail_title": { en: "Anime Detail", vi: "Chi tiết Anime" },
  "discover.loading_detail": { en: "Loading detail...", vi: "Đang tải chi tiết..." },
  "discover.metadata": { en: "Metadata", vi: "Metadata" },
  "discover.episodes": { en: "Episodes", vi: "Tập" },
  "discover.server_groups": { en: "Server Groups", vi: "Nhóm server" },
  "discover.loading_server_data": { en: "Loading server data...", vi: "Đang tải dữ liệu server..." },
  "discover.episode_prefix": { en: "Episode", vi: "Tập" },
  "discover.open_watch_page": { en: "Open watch page", vi: "Mở trang xem" },
  "discover.reported_quality": { en: "Reported quality", vi: "Chất lượng báo cáo" },
  "discover.direct_links_note": {
    en: "Direct stream links may be hidden by source protection. This launcher keeps server metadata and episode routing stable.",
    vi: "Link phát trực tiếp có thể bị ẩn bởi cơ chế bảo vệ nguồn. Launcher cố gắng giữ metadata và định tuyến tập ổn định.",
  },
  "discover.select_episode_prompt": {
    en: "Select an episode to load server groups.",
    vi: "Chọn một tập để tải nhóm server.",
  },
  "discover.select_anime_prompt": {
    en: "Select an anime card to see details.",
    vi: "Chọn một anime để xem chi tiết.",
  },
  "discover.error_home": { en: "Failed to load anime catalog.", vi: "Không thể tải danh mục anime." },
  "discover.error_detail": { en: "Failed to load anime detail.", vi: "Không thể tải chi tiết anime." },

  // Mobile nav
  "mobile_nav.game": { en: "Game", vi: "Game" },
  "mobile_nav.anime": { en: "Anime", vi: "Anime" },
  "mobile_nav.library": { en: "Library", vi: "Thư viện" },
  "mobile_nav.downloads": { en: "Downloads", vi: "Tải xuống" },
  "mobile_nav.profile": { en: "Profile", vi: "Hồ sơ" },

  // Crack Download System
  "crack.download_title": { en: "Download Fix", vi: "Tải Bản Sửa Lỗi" },
  "crack.fix_library": { en: "Fix Library", vi: "Thư Viện Sửa Lỗi" },
  "crack.game_not_installed": { en: "Game Not Installed", vi: "Game Chưa Được Cài Đặt" },
  "crack.install_game_first": {
    en: "Please install the game before downloading the fix. The fix files need to be placed in the game directory.",
    vi: "Vui lòng cài đặt game trước khi tải bản sửa lỗi. Các file sửa lỗi cần được đặt trong thư mục game."
  },
  "crack.go_to_store": { en: "Go to Store", vi: "Đi Đến Cửa Hàng" },
  "crack.install_guide_title": { en: "Installation Guide", vi: "Hướng Dẫn Cài Đặt" },
  "crack.guide_step_1": {
    en: "Make sure the game is closed before installing.",
    vi: "Đảm bảo game đã đóng trước khi cài đặt."
  },
  "crack.guide_step_2": {
    en: "Original files will be backed up automatically.",
    vi: "Các file gốc sẽ được sao lưu tự động."
  },
  "crack.guide_step_3": {
    en: "Fix files will be extracted to the game directory.",
    vi: "Các file sửa lỗi sẽ được giải nén vào thư mục game."
  },
  "crack.guide_step_4": {
    en: "You can uninstall the fix anytime to restore original files.",
    vi: "Bạn có thể gỡ bản sửa lỗi bất cứ lúc nào để khôi phục file gốc."
  },
  "crack.note": { en: "Note", vi: "Ghi chú" },
  "crack.select_version": { en: "Select Version", vi: "Chọn Phiên Bản" },
  "crack.recommended": { en: "Recommended", vi: "Đề Xuất" },
  "crack.default_option": { en: "Default Option", vi: "Tùy Chọn Mặc Định" },
  "crack.download_options": { en: "Download Options", vi: "Tùy Chọn Tải Về" },
  "crack.download_fix": { en: "Download Fix", vi: "Tải Bản Sửa" },
  "crack.download_and_install": { en: "Download & Install", vi: "Tải & Cài Đặt" },
  "crack.eta": { en: "ETA", vi: "Còn lại" },
  "crack.install_success": { en: "Fix installed successfully!", vi: "Cài đặt bản sửa thành công!" },
  "crack.uninstall": { en: "Uninstall Fix", vi: "Gỡ Bản Sửa" },
  "crack.files_restored": { en: "Files restored", vi: "File đã khôi phục" },
  "crack.files_missing": { en: "Files missing", vi: "File bị thiếu" },
  "crack.verification_passed": { en: "Game integrity verified", vi: "Đã xác minh tính toàn vẹn game" },
  "crack.denuvo_warning_title": { en: "DRM/Restrictions detected", vi: "Đã phát hiện DRM/giới hạn" },
  "crack.denuvo_warning_body": {
    en: "This title uses Denuvo Anti-Tamper. The fix may not work or the game may not be playable.",
    vi: "Game này dùng Denuvo Anti-Tamper. Bản sửa có thể không hoạt động hoặc game có thể không chơi được."
  },
  "crack.denuvo_badge": { en: "Denuvo Anti-Tamper", vi: "Denuvo Anti-Tamper" },
  "crack.dlc_count": { en: "DLCs", vi: "DLC" },
  "crack.status.pending": { en: "Preparing...", vi: "Đang chuẩn bị..." },
  "crack.status.downloading": { en: "Downloading...", vi: "Đang tải xuống..." },
  "crack.status.extracting": { en: "Extracting files...", vi: "Đang giải nén..." },
  "crack.status.backing_up": { en: "Backing up original files...", vi: "Đang sao lưu file gốc..." },
  "crack.status.installing": { en: "Installing...", vi: "Đang cài đặt..." },
  "crack.status.completed": { en: "Completed", vi: "Hoàn tất" },
  "crack.status.failed": { en: "Failed", vi: "Thất bại" },
  "crack.status.cancelled": { en: "Cancelled", vi: "Đã hủy" },

  // Online Fix
  "online_fix.tagline": { en: "Co-op ready releases", vi: "Phát hành sẵn sàng co-op" },
  "online_fix.description": {
    en: "Curated fixes matched to your Steam catalog for quick multiplayer setup.",
    vi: "Các bản fix được tuyển chọn, khớp với thư viện Steam của bạn để thiết lập chơi mạng nhanh chóng.",
  },
  "online_fix.empty": { en: "No online-fix entries yet.", vi: "Chưa có mục online-fix nào." },
  "online_fix.error": { en: "Failed to load online-fix catalog", vi: "Không tải được danh mục online-fix" },

  // Bypass
  "bypass.title": { en: "Compatibility tools", vi: "Công cụ tương thích" },
  "bypass.description": {
    en: "Targeted bypass bundles aligned to specific Steam app IDs.",
    vi: "Các gói bypass nhắm mục tiêu theo app ID Steam cụ thể.",
  },
  "bypass.loading": { en: "Loading bypass tools...", vi: "Đang tải công cụ bypass..." },
  "bypass.error": { en: "Failed to load bypass catalog", vi: "Không tải được danh mục bypass" },
  "bypass.empty": { en: "No bypass entries yet.", vi: "Chưa có mục bypass nào." },
  "bypass.category_empty": { en: "No games in this category yet.", vi: "Chưa có game nào trong danh mục này." },

  // Policy pages
  "policy.privacy_title": { en: "Privacy Policy", vi: "Chính sách Bảo mật" },
  "policy.terms_title": { en: "Terms of Service", vi: "Điều khoản Dịch vụ" },
  "policy.last_updated": { en: "Last updated", vi: "Cập nhật lần cuối" },
  "policy.important_notice": { en: "Important Notice", vi: "Lưu ý Quan trọng" },
  "policy.terms_notice": {
    en: "By using OTOSHI Launcher, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service. If you do not agree to these terms, please discontinue use of the software immediately.",
    vi: "Bằng việc sử dụng OTOSHI Launcher, bạn xác nhận rằng bạn đã đọc, hiểu và đồng ý bị ràng buộc bởi các Điều khoản Dịch vụ này. Nếu bạn không đồng ý với các điều khoản này, vui lòng ngừng sử dụng phần mềm ngay lập tức.",
  },


  // Cookie consent
  "cookie.title": { en: "Cookie preferences", vi: "Tuy chon cookie" },
  "cookie.body": {
    en: "We use cookies to improve the launcher experience and measure usage. You can accept all, allow once, or manage your preferences.",
    vi: "Chung toi su dung cookie de cai thien trai nghiem va do luong su dung. Ban co the chap nhan tat ca, cho phep mot lan, hoac tuy chon."
  },
  "cookie.accept_all": { en: "Accept all", vi: "Chap nhan tat ca" },
  "cookie.reject": { en: "Essential only", vi: "Chi can thiet" },
  "cookie.allow_once": { en: "Allow once", vi: "Cho phep mot lan" },
  "cookie.manage": { en: "Manage", vi: "Tuy chon" },
  "cookie.save": { en: "Save preferences", vi: "Luu tuy chon" },
  "cookie.learn_more": { en: "Learn more", vi: "Tim hieu them" },
  "cookie.essential": { en: "Essential cookies", vi: "Cookie thiet yeu" },
  "cookie.analytics": { en: "Analytics cookies", vi: "Cookie phan tich" },
  "cookie.marketing": { en: "Marketing cookies", vi: "Cookie quang cao" },

  // Distribute menu
  "distribute.title": { en: "Distribute on OTOSHI", vi: "Phân phối trên OTOSHI" },
  "distribute.subtitle": { en: "Publish and manage your games", vi: "Xuất bản và quản lý game của bạn" },
  "distribute.developer_portal": { en: "Developer Portal", vi: "Cổng Nhà phát triển" },
  "distribute.developer_portal_desc": { en: "Manage your games and analytics", vi: "Quản lý game và phân tích" },
  "distribute.submit_game": { en: "Submit a Game", vi: "Gửi Game" },
  "distribute.submit_game_desc": { en: "Start publishing on OTOSHI", vi: "Bắt đầu xuất bản trên OTOSHI" },
  "distribute.sdk_tools": { en: "SDK & Tools", vi: "SDK & Công cụ" },
  "distribute.sdk_tools_desc": { en: "Integration libraries and CLI", vi: "Thư viện tích hợp và CLI" },
  "distribute.documentation": { en: "Documentation", vi: "Tài liệu" },
  "distribute.documentation_desc": { en: "API reference and guides", vi: "Tham khảo API và hướng dẫn" },
  "distribute.revenue_share": { en: "88% revenue share for developers", vi: "88% doanh thu cho nhà phát triển" },

  // Workshop
  "workshop.title": { en: "Workshop", vi: "Workshop" },
  "workshop.heading": { en: "Community creations", vi: "Sang tao cong dong" },
  "workshop.subtitle": {
    en: "Subscribe to mods, maps, and UI packs curated by the Otoshi community.",
    vi: "Dang ky mod, map va goi UI duoc cong dong Otoshi tuyen chon."
  },
  "workshop.steam_read_only": { en: "Steam Workshop (read-only)", vi: "Steam Workshop (chi doc)" },
  "workshop.search_placeholder": { en: "Search workshop", vi: "Tim workshop" },
  "workshop.syncing": { en: "Syncing...", vi: "Dang dong bo..." },
  "workshop.sync_local": { en: "Sync Local", vi: "Dong bo local" },
  "workshop.loading": { en: "Loading workshop...", vi: "Dang tai workshop..." },
  "workshop.installed": { en: "Installed", vi: "Da cai dat" },
  "workshop.apply_to_game": { en: "Apply to Game", vi: "Ap dung vao game" },
  "workshop.open_folder": { en: "Open Folder", vi: "Mo thu muc" },
  "workshop.install_on_steam": { en: "Install on Steam", vi: "Cai tren Steam" },
  "workshop.subscribed": { en: "Subscribed", vi: "Da dang ky" },
  "workshop.subscribe": { en: "Subscribe", vi: "Dang ky" },
  "workshop.default_description": { en: "Community curated content pack.", vi: "Goi noi dung do cong dong tuyen chon." },
  "workshop.general": { en: "general", vi: "chung" },
  "workshop.subscribers": { en: "subscribers", vi: "nguoi dang ky" },
  "workshop.downloads": { en: "downloads", vi: "luot tai" },
  "workshop.notice_unavailable": {
    en: "not avalable rn, update soon :))",
    vi: "Tam chua co, update soon :))"
  },
  "workshop.error.load": { en: "Failed to load workshop", vi: "Khong tai duoc workshop" },
  "workshop.error.local_installs": { en: "Failed to load local workshop installs", vi: "Khong tai duoc workshop local installs" },
  "workshop.error.load_steam": { en: "Failed to load Steam Workshop", vi: "Khong tai duoc Steam Workshop" },
  "workshop.error.refresh_local": { en: "Failed to refresh local installs", vi: "Khong refresh duoc local installs" },
  "workshop.error.sync": { en: "Failed to sync workshop to game", vi: "Khong sync duoc workshop vao game" },
  "workshop.error.subscription": { en: "Subscription update failed", vi: "Cap nhat dang ky that bai" },

  // Downloads
  "downloads.title": { en: "Downloads", vi: "Tai xuong" },
  "downloads.subtitle": {
    en: "Live queue, resumable chunking, install verification, and CDN fallback.",
    vi: "Hang doi realtime, chunk resume, xac minh cai dat va CDN fallback."
  },
  "downloads.active_queue": { en: "Active queue", vi: "Hang doi dang chay" },
  "downloads.recent_finished": { en: "Recently finished", vi: "Vua hoan tat" },
  "downloads.current_throughput": { en: "Current throughput", vi: "Thong luong hien tai" },
  "downloads.fetching_queue": { en: "Fetching download queue...", vi: "Dang lay hang doi tai xuong..." },
  "downloads.empty_queue": { en: "Your queue is empty.", vi: "Hang doi dang trong." },
  "downloads.recent_activity": { en: "Recent activity", vi: "Hoat dong gan day" },
  "downloads.network_pulse": { en: "Network Pulse", vi: "Nhip mang" },
  "downloads.active_lanes": { en: "Active lanes", vi: "Luong dang chay" },
  "downloads.peak_throughput": { en: "Peak throughput", vi: "Thong luong toi da" },
  "downloads.patch_efficiency": { en: "Patch efficiency", vi: "Hieu qua patch" },
  "downloads.cdn_auto_edge": {
    en: "CDN edge automatically selected based on latency and capacity.",
    vi: "CDN edge tu dong chon dua tren do tre va dung luong."
  },
  "downloads.secure_cdn": { en: "Secure CDN", vi: "CDN an toan" },
  "downloads.realtime_telemetry": { en: "Realtime telemetry", vi: "Telemetry realtime" },
  "downloads.remaining": { en: "remaining", vi: "con lai" },
  "downloads.eta": { en: "ETA", vi: "Con lai" },
  "downloads.network": { en: "Network", vi: "Mang" },
  "downloads.read": { en: "Read", vi: "Doc" },
  "downloads.write": { en: "Write", vi: "Ghi" },
  "downloads.appid": { en: "APPID", vi: "APPID" },
  "downloads.stop": { en: "Stop", vi: "Dung" },

  // Developer
  "developer.depot_name": { en: "Depot name", vi: "Ten depot" },
  "developer.platform": { en: "Platform", vi: "Nen tang" },
  "developer.branch": { en: "Branch", vi: "Nhanh" },
  "developer.version": { en: "Version", vi: "Phien ban" },
  "developer.placeholder.depot_name": { en: "Windows primary", vi: "Windows primary" },
  "developer.placeholder.platform": { en: "windows", vi: "windows" },
  "developer.placeholder.branch": { en: "main", vi: "main" },
  "developer.placeholder.version": { en: "1.2.0", vi: "1.2.0" },

  // Inventory
  "inventory.placeholder.target_user_id": { en: "Target user id", vi: "ID nguoi nhan" },
  "inventory.placeholder.offered_item_ids": { en: "Offered item ids (comma separated)", vi: "ID vat pham dua ra (cach nhau boi dau phay)" },
  "inventory.placeholder.requested_item_ids": { en: "Requested item ids (comma separated)", vi: "ID vat pham yeu cau (cach nhau boi dau phay)" },

  // Profile
  "profile.placeholder.public_name": { en: "Your public name", vi: "Ten hien thi cong khai" },
  "profile.placeholder.url_example": { en: "https://...", vi: "https://..." },
  "profile.placeholder.headline": { en: "Creator, streamer, or pro player", vi: "Creator, streamer, hoac pro player" },
  "profile.placeholder.bio": { en: "Share your story, favorite genres, or recent achievements.", vi: "Chia se cau chuyen, the loai yeu thich, hoac thanh tuu gan day." },
  "profile.placeholder.location": { en: "Ho Chi Minh City", vi: "Ho Chi Minh City" },
  "profile.placeholder.website": { en: "https://", vi: "https://" },
  "profile.placeholder.handle": { en: "@handle", vi: "@handle" },
  "profile.placeholder.channel": { en: "channel", vi: "kenh" },
  "profile.placeholder.target_device": { en: "desktop-main", vi: "desktop-main" },

  // Download options / Reviews / Play
  "download_options.title": { en: "Download options", vi: "Tuy chon tai xuong" },
  "download_options.version": { en: "Version", vi: "Phien ban" },
  "download_options.loading": { en: "Loading options...", vi: "Đang tải tùy chọn..." },
  "download_options.badge_steam": { en: "Steam download", vi: "Tải từ Steam" },
  "download_options.section.method": { en: "Download method", vi: "Phương thức tải" },
  "download_options.section.version": { en: "Version", vi: "Phiên bản" },
  "download_options.section.install_location": { en: "Install location", vi: "Vị trí cài đặt" },
  "download_options.section.storage": { en: "Storage", vi: "Dung lượng" },
  "download_options.section.fixes": { en: "Fixes", vi: "Fix" },
  "download_options.section.current_task": { en: "Current task", vi: "Tác vụ hiện tại" },
  "download_options.section.preparing": { en: "Preparing install", vi: "Chuẩn bị cài đặt" },
  "download_options.method_recommended": { en: "Recommended", vi: "Đề xuất" },
  "download_options.browse": { en: "Browse", vi: "Duyệt" },
  "download_options.browse_unavailable": {
    en: "Folder picker is available in the desktop app.",
    vi: "Chức năng chọn thư mục chỉ có trên bản desktop."
  },
  "download_options.create_subfolder": {
    en: "Create a game subfolder automatically",
    vi: "Tự động tạo thư mục con cho game"
  },
  "download_options.install_path_final": { en: "Final path", vi: "Đường dẫn cuối cùng" },
  "download_options.storage_required": { en: "Required", vi: "Cần" },
  "download_options.storage_free": { en: "Free space", vi: "Còn trống" },
  "download_options.storage_total": { en: "Total", vi: "Tổng" },
  "download_options.storage_not_enough": {
    en: "Not enough free space for this download.",
    vi: "Không đủ dung lượng trống để tải."
  },
  "download_options.fix_online": { en: "Online Fix", vi: "Online Fix" },
  "download_options.fix_bypass": { en: "Bypass", vi: "Bypass" },
  "download_options.available": { en: "Available", vi: "Có sẵn" },
  "download_options.not_available": { en: "Not available", vi: "Không có" },
  "download_options.open_online_fix": { en: "Open Online Fix", vi: "Mở Online Fix" },
  "download_options.open_bypass": { en: "Open Bypass", vi: "Mở Bypass" },
  "download_options.summary_manifest": {
    en: "Download size uses manifests when available, otherwise Steam requirements.",
    vi: "Dung lượng tải sẽ dùng manifest nếu có, nếu không sẽ dùng yêu cầu từ Steam."
  },
  "download_options.cancel": { en: "Cancel", vi: "Hủy" },
  "download_options.download": { en: "Download", vi: "Tải xuống" },
  "download_options.preparing_button": { en: "Preparing...", vi: "Đang chuẩn bị..." },
  "download_options.pause": { en: "Pause", vi: "Tạm dừng" },
  "download_options.resume": { en: "Resume", vi: "Tiếp tục" },
  "download_options.stop": { en: "Stop", vi: "Dừng" },
  "download_options.hf_unavailable_banner": {
    en: "This game is not updated yet. We'll update soon.",
    vi: "Game chưa được cập nhật. Chúng tôi sẽ cập nhật sớm."
  },
  "download_options.note.hf_repo_not_configured": {
    en: "This game is not updated yet. We'll update soon.",
    vi: "Game chưa được cập nhật. Chúng tôi sẽ cập nhật sớm."
  },
  "download_options.note.hf_manifest_missing": {
    en: "This game is not updated yet. We'll update soon.",
    vi: "Game chưa được cập nhật. Chúng tôi sẽ cập nhật sớm."
  },
  "download_options.note.aria2_missing": {
    en: "aria2c is not available on this device.",
    vi: "aria2c chưa có trên thiết bị này."
  },
  "download_options.note.auto_fallback_notice": {
    en: "Automatic mode will fallback to available methods.",
    vi: "Chế độ tự động sẽ chuyển sang phương thức còn khả dụng."
  },
  "reviews.headline_placeholder": { en: "Headline", vi: "Tieu de" },
  "reviews.body_placeholder": { en: "Share what stood out.", vi: "Chia se diem noi bat." },
  "reviews.publish": { en: "Publish review", vi: "Dang danh gia" },
  "play_options.title": { en: "Play options", vi: "Tuy chon choi" },
  "play_options.launching": { en: "Launching", vi: "Dang khoi chay" },

  // Steam detail / News / Properties
  "steam_detail.download_launcher_title": { en: "Download launcher to continue", vi: "Tai launcher de tiep tuc" },
  "steam_detail.download_launcher_body": {
    en: "Downloading games is available in the desktop launcher. Please install and open the launcher to continue.",
    vi: "Tai game chi ho tro tren launcher desktop. Vui long cai dat va mo launcher de tiep tuc."
  },
  "steam_detail.later": { en: "Later", vi: "De sau" },
  "steam_detail.open_launcher_download": { en: "Open launcher download", vi: "Mở trang tải launcher" },
  "steam_detail.show_price_details": { en: "Show price details", vi: "Xem chi tiet gia" },
  "steam_detail.refresh_dlc_title": { en: "Refresh DLC data", vi: "Lam moi du lieu DLC" },
  "steam_detail.refresh": { en: "Refresh", vi: "Lam moi" },
  "news.open_article": { en: "Open news article", vi: "Mo bai viet tin tuc" },
  "properties.current_location": { en: "Current Location", vi: "Vi tri hien tai" },
  "properties.new_location": { en: "New Location", vi: "Vi tri moi" },
  "properties.select_destination": { en: "Select destination folder...", vi: "Chon thu muc dich..." },
  "properties.title": { en: "Properties", vi: "Thuoc tinh" },
  "properties.loading": { en: "Loading properties...", vi: "Dang tai thuoc tinh..." },
  "properties.tab.general": { en: "General", vi: "Chung" },
  "properties.tab.updates": { en: "Updates", vi: "Cap nhat" },
  "properties.tab.installed_files": { en: "Installed Files", vi: "Tep da cai" },
  "properties.tab.dlc": { en: "DLC", vi: "DLC" },
  "properties.tab.privacy": { en: "Privacy", vi: "Rieng tu" },
  "properties.tab.customization": { en: "Customization", vi: "Tuy bien" },
  "properties.status_installed": { en: "Installed", vi: "Da cai dat" },
  "properties.status_not_installed": { en: "Not installed", vi: "Chua cai dat" },
  "properties.overlay_title": { en: "In-Game Overlay", vi: "Overlay trong game" },
  "properties.overlay_desc": { en: "Enable launcher overlay while playing.", vi: "Bat overlay launcher khi choi." },
  "properties.language_title": { en: "Language Override", vi: "Ngon ngu uu tien" },
  "properties.language_system": { en: "Use system language", vi: "Dung ngon ngu he thong" },
  "properties.launch_options_title": { en: "Launch Options", vi: "Tuy chon khoi chay" },
  "properties.launch_options_desc": { en: "Advanced users can add launch arguments.", vi: "Nguoi dung nang cao co the them tham so khoi chay." },
  "properties.launch_options_placeholder": { en: "Example: -dx12 -windowed", vi: "Vi du: -dx12 -windowed" },
  "properties.cloud_title": { en: "Cloud Sync", vi: "Dong bo cloud" },
  "properties.cloud_desc": { en: "Sync save data between devices.", vi: "Dong bo du lieu save giua cac thiet bi." },
  "properties.save_locations": { en: "locations", vi: "vi tri" },
  "properties.sync_now": { en: "Sync now", vi: "Dong bo ngay" },
  "properties.syncing": { en: "Syncing...", vi: "Dang dong bo..." },
  "properties.sync_uploaded": { en: "Uploaded", vi: "Tai len" },
  "properties.sync_downloaded": { en: "Downloaded", vi: "Tai xuong" },
  "properties.sync_conflicts": { en: "Conflicts", vi: "Xung dot" },
  "properties.sync_events": { en: "Event ID", vi: "Ma su kien" },
  "properties.sync_done": { en: "Cloud sync completed.", vi: "Dong bo cloud hoan tat." },
  "properties.current_version": { en: "Current Version", vi: "Phien ban hien tai" },
  "properties.branch": { en: "Branch", vi: "Nhanh" },
  "properties.build_id": { en: "Build ID", vi: "Build ID" },
  "properties.last_played": { en: "Last Played", vi: "Lan choi gan nhat" },
  "properties.settings_updated": { en: "Settings Updated", vi: "Cap nhat cai dat" },
  "properties.verify_desc": { en: "Verify game files against current manifest.", vi: "Xac minh file game voi manifest hien tai." },
  "properties.verify_now": { en: "Verify now", vi: "Xac minh ngay" },
  "properties.verifying": { en: "Verifying...", vi: "Dang xac minh..." },
  "properties.verify_success": { en: "All files verified.", vi: "Tat ca file hop le." },
  "properties.verify_issues": { en: "Verification found issues.", vi: "Xac minh phat hien loi." },
  "properties.total_files": { en: "Total files", vi: "Tong file" },
  "properties.verified_files": { en: "Verified", vi: "Da xac minh" },
  "properties.corrupted_files": { en: "Corrupted", vi: "Hong" },
  "properties.missing_files": { en: "Missing", vi: "Thieu" },
  "properties.install_status": { en: "Install Status", vi: "Trang thai cai dat" },
  "properties.size_on_disk": { en: "Size on Disk", vi: "Dung luong tren o dia" },
  "properties.open_folder": { en: "Open Folder", vi: "Mo thu muc" },
  "properties.move_install": { en: "Move Install Folder", vi: "Chuyen thu muc cai dat" },
  "properties.search_dlc": { en: "Search DLC...", vi: "Tim DLC..." },
  "properties.no_dlc": { en: "No DLC found.", vi: "Khong co DLC." },
  "properties.hide_in_library": { en: "Hide in library", vi: "An trong thu vien" },
  "properties.hide_in_library_desc": { en: "Hide this game from library lists.", vi: "An game nay khoi danh sach thu vien." },
  "properties.mark_private": { en: "Mark activity private", vi: "Dat hoat dong rieng tu" },
  "properties.mark_private_desc": { en: "Hide your play activity from others.", vi: "An hoat dong choi cua ban voi nguoi khac." },
  "properties.overlay_data": { en: "In-Game Overlay Data", vi: "Du lieu overlay trong game" },
  "properties.overlay_data_desc": { en: "Clear temporary in-game overlay state.", vi: "Xoa du lieu tam cua overlay trong game." },
  "properties.clear_overlay_data": { en: "Clear overlay data", vi: "Xoa du lieu overlay" },
  "properties.overlay_data_cleared": { en: "Overlay data was cleared.", vi: "Da xoa du lieu overlay." },
  "properties.artwork_title": { en: "Artwork", vi: "Artwork" },
  "properties.artwork_cover": { en: "Cover", vi: "Cover" },
  "properties.artwork_background": { en: "Background", vi: "Background" },
  "properties.artwork_logo": { en: "Logo", vi: "Logo" },
  "properties.no_custom_asset": { en: "Default asset in use", vi: "Dang dung anh mac dinh" },
  "properties.select_image": { en: "Select image file", vi: "Chon file anh" },
  "properties.change": { en: "Change", vi: "Thay doi" },
  "properties.reset": { en: "Reset", vi: "Dat lai" },
  "properties.uninstall_confirm_title": { en: "Uninstall this game?", vi: "Go cai dat game nay?" },
  "properties.uninstall_confirm_desc": { en: "All installed files will be removed from disk.", vi: "Tat ca file da cai dat se bi xoa khoi o dia." },
  "properties.uninstalling": { en: "Uninstalling...", vi: "Dang go cai dat..." },
  "properties.uninstall_success": { en: "Game uninstalled successfully.", vi: "Go cai dat thanh cong." },
  "properties.move_title": { en: "Move installation", vi: "Chuyen noi cai dat" },
  "properties.move_desc": { en: "Choose a new destination for this game.", vi: "Chon vi tri moi cho game nay." },
  "properties.move_success": { en: "Game moved successfully.", vi: "Da chuyen game thanh cong." },
  "properties.moving": { en: "Moving...", vi: "Dang chuyen..." },
  "properties.saved_general": { en: "General settings saved.", vi: "Da luu cai dat chung." },
  "properties.saved_privacy": { en: "Privacy settings saved.", vi: "Da luu cai dat rieng tu." },
  "properties.saved_dlc": { en: "DLC preferences saved.", vi: "Da luu tuy chon DLC." },
  "properties.saved_customization": { en: "Customization saved.", vi: "Da luu tuy bien." },
  "properties.saving": { en: "Saving...", vi: "Dang luu..." },

  // Download statuses
  "download.status.queued": { en: "Queued", vi: "Dang xep hang" },
  "download.status.cancelled": { en: "Cancelled", vi: "Da huy" },
  "download.toast.started_title": { en: "Download started", vi: "Bắt đầu tải" },
  "download.toast.failed_title": { en: "Download failed", vi: "Tải xuống thất bại" },
  "download.toast.failed_default": { en: "Download failed to start.", vi: "Không thể bắt đầu tải xuống." },
  "download.error.start_failed": { en: "Download failed to start.", vi: "Không thể bắt đầu tải xuống." },
  "download.error.auth_required": { en: "Authentication required. Please login to download games.", vi: "Cần đăng nhập để tải game." },
  "download.error.security_blocked": {
    en: "Security policy blocked this download action.",
    vi: "Chính sách bảo mật đã chặn thao tác tải xuống này."
  },
  "download.error.method_unavailable": { en: "Selected download method is unavailable.", vi: "Phương thức tải xuống đã chọn hiện không khả dụng." },
  "download.error.game_not_updated": {
    en: "This game is not updated yet. We'll update soon.",
    vi: "Game chưa được cập nhật. Chúng tôi sẽ cập nhật sớm."
  },
  "app.about.title": { en: "About Otoshi Launcher", vi: "Về Otoshi Launcher" },
  "app.about.description": {
    en: "Otoshi Launcher desktop client with high-performance downloads, patching, and workshop integration.",
    vi: "Ứng dụng desktop Otoshi Launcher với tải tốc độ cao, vá dữ liệu và tích hợp workshop."
  },
  "app.about.version_label": { en: "Version", vi: "Phiên bản" },
  "app.about.desktop_build": { en: "desktop build", vi: "bản desktop" },
  "app.about.close": { en: "Close", vi: "Đóng" },
  "app.about.open_website": { en: "Open Official Website", vi: "Mở trang chính thức" },
  "discover.paused.title": { en: "Anime updates are paused", vi: "Mục Anime đang tạm dừng" },
  "discover.paused.message": { en: "We'll update soon.", vi: "Chúng tôi sẽ cập nhật sớm." },
  "discover.paused.context": {
    en: "This section is temporarily paused while we prepare new content.",
    vi: "Mục này đang tạm dừng để chuẩn bị nội dung mới."
  },
  "discover.paused.action_store": { en: "Back to Store", vi: "Quay về Cửa hàng" },
  "update_banner.new_version_prefix": { en: "New version", vi: "Phiên bản mới" },
  "update_banner.new_version_suffix": { en: "is ready!", vi: "đã sẵn sàng!" },
  "update_banner.maintenance_default": {
    en: "System is under maintenance. Some features may be unavailable.",
    vi: "Hệ thống đang bảo trì. Một số tính năng có thể không hoạt động."
  },
  "update_banner.checking": { en: "Checking...", vi: "Đang kiểm tra..." },
  "update_banner.check_updates": { en: "Check updates", vi: "Kiểm tra cập nhật" },

  // Hypervisor Beta Crack Warning
  "crack.hypervisor_beta_warning": { en: "Hypervisor Beta Crack - Not recommended for inexperienced users", vi: "Hypervisor Beta Crack - Không khuyến khích cho người dùng không có kinh nghiệm" },
  
  // Hypervisor Setup Instructions
  "hypervisor.notes_title": { en: "Hypervisor Notes", vi: "Ghi chú Hypervisor" },
  "hypervisor.enable_virtualization": { en: "Enable virtualization in bios settings (VT-x)", vi: "Bật virtualization trong BIOS (VT-x)" },
  "hypervisor.meltdown_mitigation": { en: "For users who have Intel 8th gen and below processors; it is needed to disable the OS Meltdown mitigations to be able to load the hypervisor.", vi: "Đối với người dùng có bộ xử lý Intel thế hệ 8 trở xuống; cần phải tắt Meltdown mitigations của OS để có thể tải hypervisor." },
  "hypervisor.inspect_tool": { en: "Some new generations may also have this enabled, it can be checked via the included InSpectre tool in the Hypervisor folder.", vi: "Một số thế hệ mới cũng có thể được bật, có thể kiểm tra thông qua công cụ InSpectre đi kèm trong thư mục Hypervisor." },
  "hypervisor.disable_meltdown_button": { en: "If the \"Disable Meltdown Protection\" button is grayed out, it is patched on hardware level for your CPU and no action is needed, proceed with the next steps.", vi: "Nếu nút \"Disable Meltdown Protection\" bị tắt, điều đó có nghĩa là bộ xử lý của bạn đã được vá ở cấp độ phần cứng và không cần thao tác nào, hãy tiếp tục các bước tiếp theo." },
  "hypervisor.kernel_anticheats": { en: "Kernel anticheats will be problematic, make sure they are off before performing the rest of the steps.", vi: "Kernel anticheats sẽ gây vấn đề, hãy chắc chắn rằng chúng bị tắt trước khi thực hiện các bước còn lại." },
  "hypervisor.enable_test_signing": { en: "Enable test signing mode via bcdedit (bcdedit /set testsigning on)", vi: "Bật chế độ test signing qua bcdedit (bcdedit /set testsigning on)" },
  "hypervisor.hyperv_disabled": { en: "For users with Hyper-V windows feature enabled, it's required to keep its hypervisor off with the following command:", vi: "Đối với người dùng có tính năng Hyper-V Windows được bật, cần phải tắt hypervisor của nó bằng lệnh sau:" },
  "hypervisor.hyperv_command": { en: "bcdedit /set hypervisorlaunchtype off", vi: "bcdedit /set hypervisorlaunchtype off" },
  "hypervisor.secure_boot": { en: "Keep Secure Boot disabled", vi: "Giữ Secure Boot bị tắt" },
  "hypervisor.windows_defender": { en: "Keep Windows Defender memory integrity and credential guard off (VBS and HVCI)", vi: "Giữ Windows Defender memory integrity và credential guard bị tắt (VBS và HVCI)" },
  "hypervisor.usage_title": { en: "Usage", vi: "Cách sử dụng" },
  "hypervisor.usage_intro": { en: "In a cmd or powershell with admin rights, after meeting the requirements:", vi: "Trong cmd hoặc powershell có quyền admin, sau khi đáp ứng các yêu cầu:" },
  "hypervisor.create_service": { en: "sc create denuvo type=kernel start=demand binPath=C:\\Drivers\\Hypervisor\\hyperkd.sys (your full path for hyperkd.sys)", vi: "sc create denuvo type=kernel start=demand binPath=C:\\Drivers\\Hypervisor\\hyperkd.sys (đường dẫn đầy đủ của bạn cho hyperkd.sys)" },
  "hypervisor.start_service": { en: "sc start denuvo", vi: "sc start denuvo" },
  "hypervisor.stop_note": { en: "After you close the game, you can stop the hypervisor service with", vi: "Sau khi đóng trò chơi, bạn có thể dừng dịch vụ hypervisor bằng" },
  "hypervisor.stop_service": { en: "sc stop denuvo", vi: "sc stop denuvo" },
  "hypervisor.installation_title": { en: "Installation Steps", vi: "Các bước cài đặt" },
  "hypervisor.step1": { en: "Load the hyperkd.sys file in the \"Hypervisor\" folder. The .dll files must remain next to it.", vi: "Tải tệp hyperkd.sys trong thư mục \"Hypervisor\". Các tệp .dll phải vẫn ở bên cạnh nó." },
  "hypervisor.step2": { en: "Copy and paste everything else apart from the hypervisor folders to the main game directory", vi: "Sao chép và dán mọi thứ khác ngoài các thư mục hypervisor vào thư mục trò chơi chính" },
  "hypervisor.step3": { en: "Launch b1-Win64-Shipping.exe", vi: "Khởi chạy b1-Win64-Shipping.exe" },

  // Fix Detail Page
  "fix_detail.back_to": { en: "Back to", vi: "Quay lại" },
  "fix_detail.online_fix_label": { en: "Online Fix", vi: "Sửa Lỗi Online" },
  "fix_detail.bypass_label": { en: "Bypass", vi: "Bỏ Qua Bảo Vệ" },
  "fix_detail.download_source": { en: "Download source", vi: "Nguồn tải xuống" },
  "fix_detail.download_link": { en: "Download link", vi: "Liên kết tải xuống" },
  "fix_detail.link_number": { en: "Link {index}", vi: "Liên kết {index}" },
  "fix_detail.version_label": { en: "Version", vi: "Phiên bản" },
  "fix_detail.open_download_popup": { en: "Open download popup", vi: "Mở cửa sổ tải xuống" },
  "fix_detail.warnings": { en: "Warnings", vi: "Cảnh báo" },
  "fix_detail.notes": { en: "Notes", vi: "Ghi chú" },

  // Guide titles and summaries
  "guide.bypass.default.title": { en: "Bypass Setup Guide", vi: "Hướng Dẫn Cấu Hình Bypass" },
  "guide.bypass.default.summary": { en: "Instructions for installing and configuring bypasses. Review the notes carefully before proceeding.", vi: "Hướng dẫn cài đặt và cấu hình bypass. Hãy xem kỹ các ghi chú trước khi tiếp tục." },
  "guide.bypass.2358720.title": { en: "Black Myth: Wukong - Hypervisor Setup", vi: "Black Myth: Wukong - Cấu Hình Hypervisor" },
  "guide.bypass.2358720.summary": { en: "Simplified setup guide for Black Myth: Wukong. Follow 4 simple steps to install and run.", vi: "Hướng dẫn cấu hình đơn giản cho Black Myth: Wukong. Thực hiện 4 bước đơn giản để cài đặt và chạy." },
  "guide.bypass.1777620.title": { en: "Soul Hackers 2 - Hypervisor Setup", vi: "Soul Hackers 2 - Cấu Hình Hypervisor" },
  "guide.bypass.1777620.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.2513280.title": { en: "Sonic X Shadow Generations - Hypervisor Setup", vi: "Sonic X Shadow Generations - Cấu Hình Hypervisor" },
  "guide.bypass.2513280.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.1794960.title": { en: "Sonic Origins - Hypervisor Setup", vi: "Sonic Origins - Cấu Hình Hypervisor" },
  "guide.bypass.1794960.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.2486820.title": { en: "Sonic Racing: CrossWorlds - Hypervisor Setup", vi: "Sonic Racing: CrossWorlds - Cấu Hình Hypervisor" },
  "guide.bypass.2486820.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.1285190.title": { en: "Borderlands 4 - Hypervisor Setup", vi: "Borderlands 4 - Cấu Hình Hypervisor" },
  "guide.bypass.1285190.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.1235140.title": { en: "Final Fantasy VII Rebirth - Hypervisor Setup", vi: "Final Fantasy VII Rebirth - Cấu Hình Hypervisor" },
  "guide.bypass.1235140.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.2072450.title": { en: "Like a Dragon: Infinite Wealth - Hypervisor Setup", vi: "Like a Dragon: Infinite Wealth - Cấu Hình Hypervisor" },
  "guide.bypass.2072450.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.2161700.title": { en: "Persona 3 Reload - Hypervisor Setup", vi: "Persona 3 Reload - Cấu Hình Hypervisor" },
  "guide.bypass.2161700.summary": { en: "This is a Hypervisor Beta crack. Advanced setup required. Not recommended for inexperienced users.", vi: "Đây là Hypervisor Beta crack. Cần cấu hình nâng cao. Không khuyên dùng cho người dùng không có kinh nghiệm." },
  "guide.bypass.809890.title": { en: "Shining Resonance Refrain - Bypass Setup", vi: "Shining Resonance Refrain - Cấu Hình Bypass" },
  "guide.bypass.809890.summary": { en: "Standard bypass installation guide. Follow these 4 steps to install and run.", vi: "Hướng dẫn cài đặt bypass tiêu chuẩn. Thực hiện 4 bước sau để cài đặt và chạy." },

  // Guide steps - Standard 4-step bypass
  "guide.step.download_bypass_extract": { en: "Download and extract bypass files", vi: "Tải xuống và giải nén các tệp bypass" },
  "guide.step.download_bypass_extract_desc": { en: "Download the bypass files from the provided link. Extract them to a temporary location.", vi: "Tải xuống các tệp bypass từ liên kết được cung cấp. Giải nén chúng vào một vị trí tạm thời." },
  "guide.step.copy_to_game_folder": { en: "Copy files to game folder", vi: "Sao chép tệp vào thư mục trò chơi" },
  "guide.step.copy_to_game_folder_desc": { en: "Copy all bypass files from the extracted folder into your game installation directory. Replace files when prompted.", vi: "Sao chép tất cả các tệp bypass từ thư mục được giải nén vào thư mục cài đặt trò chơi của bạn. Thay thế tệp khi được nhắc." },
  "guide.step.launch_game_standard": { en: "Launch the game", vi: "Khởi chạy trò chơi" },
  "guide.step.launch_game_standard_desc": { en: "Run the game executable from the game installation directory. The bypass should now be active.", vi: "Chạy tệp thực thi trò chơi từ thư mục cài đặt trò chơi. Bypass bây giờ sẽ hoạt động." },

  // Guide steps - Default bypass setup
  "guide.step.download_bypass_files": { en: "Download the bypass files", vi: "Tải xuống các tệp bypass" },
  "guide.step.download_bypass_files_desc": { en: "Download the crack files from the provided link. Make sure to extract them to a secure location.", vi: "Tải xuống các tệp crack từ liên kết được cung cấp. Hãy chắc chắn trích xuất chúng vào một vị trí an toàn." },
  "guide.step.locate_game_directory": { en: "Locate game directory", vi: "Định vị thư mục trò chơi" },
  "guide.step.locate_game_directory_desc": { en: "Find your game installation directory. This is typically in your Steam library folder.", vi: "Tìm thư mục cài đặt trò chơi của bạn. Điều này thường nằm trong thư mục thư viện Steam của bạn." },
  "guide.step.apply_crack": { en: "Apply the crack", vi: "Áp dụng crack" },
  "guide.step.apply_crack_desc": { en: "Follow the crack's instructions carefully. Different cracks may have different installation procedures.", vi: "Tuân theo hướng dẫn của crack một cách cẩn thận. Các crack khác nhau có thể có quy trình cài đặt khác nhau." },

  // Guide steps - Hypervisor setup
  "guide.step.prerequisites_check": { en: "Prerequisites Check", vi: "Kiểm Tra Điều Kiện Tiên Quyết" },
  "guide.step.prerequisites_check_desc": { en: "Enable virtualization in BIOS (VT-x). Disable kernel anticheats. Check Intel generations for Meltdown mitigation requirements using InSpectre tool.", vi: "Bật virtualization trong BIOS (VT-x). Tắt kernel anticheats. Kiểm tra thế hệ Intel để yêu cầu giảm thiểu Meltdown bằng công cụ InSpectre." },
  "guide.step.system_configuration": { en: "System Configuration", vi: "Cấu Hình Hệ Thống" },
  "guide.step.system_configuration_desc": { en: "Enable test signing mode: bcdedit /set testsigning on. If Hyper-V is enabled: bcdedit /set hypervisorlaunchtype off. Disable Secure Boot. Disable Windows Defender memory integrity and credential guard (VBS and HVCI).", vi: "Bật chế độ ký thử nghiệm: bcdedit /set testsigning on. Nếu Hyper-V được bật: bcdedit /set hypervisorlaunchtype off. Tắt Secure Boot. Tắt Windows Defender memory integrity và credential guard (VBS và HVCI)." },
  "guide.step.load_hypervisor_service": { en: "Load Hypervisor Service", vi: "Tải Dịch Vụ Hypervisor" },
  "guide.step.load_hypervisor_service_desc": { en: "Run in admin CMD/PowerShell: sc create denuvo type=kernel start=demand binPath=C:\\Drivers\\Hypervisor\\hyperkd.sys", vi: "Chạy trong admin CMD/PowerShell: sc create denuvo type=kernel start=demand binPath=C:\\Drivers\\Hypervisor\\hyperkd.sys" },
  "guide.step.start_service": { en: "Start Service", vi: "Bắt Đầu Dịch Vụ" },
  "guide.step.start_service_desc": { en: "Run: sc start denuvo", vi: "Chạy: sc start denuvo" },
  "guide.step.install_game_files": { en: "Install Game Files", vi: "Cài Đặt Các Tệp Trò Chơi" },
  "guide.step.install_game_files_desc": { en: "1 - Load the hyperkd.sys file in the Hypervisor folder. The .dll files must remain next to it. 2 - Copy and paste everything else from crack to the main game directory. 3 - Launch the game executable", vi: "1 - Tải tệp hyperkd.sys trong thư mục Hypervisor. Các tệp .dll phải ở bên cạnh nó. 2 - Sao chép và dán mọi thứ khác từ crack vào thư mục trò chơi chính. 3 - Khởi chạy tệp thực thi trò chơi" },
  "guide.step.stop_service": { en: "Stop Service", vi: "Dừng Dịch Vụ" },
  "guide.step.stop_service_desc": { en: "After playing, run: sc stop denuvo", vi: "Sau khi chơi, chạy: sc stop denuvo" },

  // Guide steps - Black Myth Wukong (simplified)
  "guide.step.copy_crack_folder": { en: "Copy Crack Folder", vi: "Sao Chép Thư Mục Crack" },
  "guide.step.copy_crack_folder_desc": { en: "Copy the crack folder to the game installation directory.", vi: "Sao chép thư mục crack vào thư mục cài đặt trò chơi." },
  "guide.step.enable_vtx_svm": { en: "Enable VT-x / SVM", vi: "Bật VT-x / SVM" },
  "guide.step.enable_vtx_svm_desc": { en: "Enable VT-x (Intel) or SVM (AMD) virtualization in BIOS. You can verify these features are enabled by opening b1 Launcher.exe - if they're disabled, you can click the 'Open BIOS' button to configure them.", vi: "Bật VT-x (Intel) hoặc SVM (AMD) virtualization trong BIOS. Bạn có thể xác minh những tính năng này được bật bằng cách mở b1 Launcher.exe - nếu chúng bị tắt, bạn có thể nhấp nút 'Open BIOS' để cấu hình chúng." },
  "guide.step.disable_secure_boot": { en: "Disable Secure Boot", vi: "Tắt Secure Boot" },
  "guide.step.disable_secure_boot_desc": { en: "Disable Secure Boot in BIOS settings.", vi: "Tắt Secure Boot trong cài đặt BIOS." },
  "guide.step.launch_game": { en: "Launch Game", vi: "Khởi Chạy Trò Chơi" },
  "guide.step.launch_game_desc": { en: "Open b1 Launcher.exe and run the game. If your system requires a restart, please follow the instructions provided.", vi: "Mở b1 Launcher.exe và chạy trò chơi. Nếu hệ thống của bạn yêu cầu khởi động lại, vui lòng tuân theo hướng dẫn được cung cấp." },

  // Warnings and notes
  "guide.warning.scan_antivirus": { en: "Always scan downloaded files with antivirus software before extracting", vi: "Luôn quét các tệp đã tải xuống bằng phần mềm chống virus trước khi trích xuất" },
  "guide.warning.backup": { en: "Create a backup of your game before applying any crack", vi: "Tạo bản sao lưu trò chơi của bạn trước khi áp dụng bất kỳ crack" },
  "guide.warning.antivirus_flags": { en: "Some antivirus software may flag crack files as threats - this is normal", vi: "Một số phần mềm chống virus có thể gắn cờ các tệp crack như mối đe dọa - điều này bình thường" },
  "guide.warning.beta_software": { en: "This is experimental beta software", vi: "Đây là phần mềm beta thử nghiệm" },
  "guide.warning.advanced_users": { en: "Only for advanced users with virtualization experience", vi: "Chỉ dành cho người dùng nâng cao có kinh nghiệm ảo hóa" },
  "guide.warning.conflict_security": { en: "May conflict with security tools", vi: "Có thể xung đột với các công cụ bảo mật" },
  "guide.warning.config_prevent": { en: "Improper configuration may prevent game launch", vi: "Cấu hình không phù hợp có thể ngăn khởi chạy trò chơi" },
  "guide.warning.bios_changes": { en: "Requires BIOS configuration changes", vi: "Yêu cầu thay đổi cấu hình BIOS" },
  "guide.warning.restart": { en: "System restart may be necessary", vi: "Có thể cần khởi động lại hệ thống" },
  "guide.warning.b1launcher_only": { en: "Only run b1 Launcher.exe from the game directory", vi: "Chỉ chạy b1 Launcher.exe từ thư mục trò chơi" },

  "guide.note.supports_amd_intel": { en: "Supports both AMD and Intel processors", vi: "Hỗ trợ cả bộ xử lý AMD và Intel" },
  "guide.note.meltdown_mitigation": { en: "Meltdown mitigation may need to be disabled for older CPUs", vi: "Giảm thiểu Meltdown có thể cần được tắt cho các CPU cũ" },
  "guide.note.dll_files": { en: "Keep all .dll files next to hyperkd.sys", vi: "Giữ tất cả các tệp .dll bên cạnh hyperkd.sys" },
  "guide.note.check_readme": { en: "Check crack README for the specific game executable name (varies per game)", vi: "Kiểm tra crack README để biết tên tệp thực thi trò chơi cụ thể (khác nhau tùy theo trò chơi)" },
  "guide.note.requires_intel_8gen": { en: "Requires Intel 8th gen or newer (or AMD equivalent)", vi: "Yêu cầu Intel thế hệ 8 trở lên (hoặc tương đương AMD)" },
  "guide.note.optimized_intel_8gen": { en: "Optimized for Intel 8th gen or newer processors", vi: "Được tối ưu hóa cho bộ xử lý Intel thế hệ 8 trở lên" },
  "guide.note.b1launcher_check": { en: "The b1 Launcher.exe will check if VT-x/SVM are properly enabled", vi: "b1 Launcher.exe sẽ kiểm tra xem VT-x/SVM có được bật đúng cách hay không" },
  "guide.note.restart_requirement": { en: "Some systems may require a restart after enabling virtualization", vi: "Một số hệ thống có thể cần khởi động lại sau khi bật ảo hóa" },
  "guide.note.crack_folder_copy": { en: "Ensure the entire crack folder is properly copied to the game directory", vi: "Đảm bảo toàn bộ thư mục crack được sao chép đúng cách vào thư mục trò chơi" },
};

const normalizeLocale = (value: string | null | undefined): Locale => {
  if (!value) return "en";
  const cleaned = value.replace("_", "-").toLowerCase();
  return cleaned.startsWith("vi") ? "vi" : "en";
};

const readCachedBundle = (locale: Locale): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${LOCALE_BUNDLE_CACHE_PREFIX}${locale}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (typeof value === "string") {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
};

const writeCachedBundle = (locale: Locale, bundle: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${LOCALE_BUNDLE_CACHE_PREFIX}${locale}`,
      JSON.stringify(bundle)
    );
  } catch {
    // Ignore storage write failures.
  }
};

const loadStaticBundle = async (locale: Locale): Promise<Record<string, string>> => {
  try {
    const response = await fetch(`/locales/${locale}.json`, { cache: "no-store" });
    if (!response.ok) return {};
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return {};
    return Object.entries(payload as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (typeof value === "string") {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalizeLocale(stored);
  });
  const [bundleMessages, setBundleMessages] = useState<Record<string, string>>(() =>
    readCachedBundle(
      typeof window === "undefined"
        ? "en"
        : normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
    )
  );
  const missingKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    setBundleMessages(readCachedBundle(locale));
  }, [locale]);

  const refreshLocaleBundle = useCallback(async (targetLocale: Locale) => {
    const [staticBundle, remoteBundle] = await Promise.all([
      loadStaticBundle(targetLocale),
      fetchLocaleBundle(targetLocale).catch(() => ({})),
    ]);
    const merged = {
      ...staticBundle,
      ...remoteBundle,
    };
    setBundleMessages(merged);
    writeCachedBundle(targetLocale, merged);
  }, []);

  useEffect(() => {
    let active = true;
    fetchLocaleSettings()
      .then((data) => {
        if (!active) return;
        const resolved = normalizeLocale(data.locale || data.systemLocale);
        setLocaleState(resolved);
        void refreshLocaleBundle(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshLocaleBundle]);

  useEffect(() => {
    void refreshLocaleBundle(locale);
  }, [locale, refreshLocaleBundle]);

  const setLocale = (value: Locale) => {
    setLocaleState(value);
    updateLocaleSettings(value).catch(() => undefined);
  };

  const t = useCallback(
    (key: string) => {
      const value =
        bundleMessages[key] ||
        messages[key]?.[locale] ||
        messages[key]?.en;
      if (value) {
        return value;
      }

      if (!missingKeysRef.current.has(key)) {
        missingKeysRef.current.add(key);
        console.warn(`[i18n] Missing locale key: ${key}`);
      }
      return key;
    },
    [bundleMessages, locale]
  );

  const options = useMemo(
    () => [
      { value: "en" as const, label: t("locale.english"), shortLabel: "EN" },
      { value: "vi" as const, label: t("locale.vietnamese"), shortLabel: "VI" }
    ],
    [t]
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, options }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
