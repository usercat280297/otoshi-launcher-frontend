import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchLocaleSettings, updateLocaleSettings } from "../services/api";

type Locale = "en" | "vi";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (value: Locale) => void;
  t: (key: string) => string;
  options: Array<{ value: Locale; label: string; shortLabel: string }>;
};

const LOCALE_STORAGE_KEY = "otoshi_locale";

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
  "discover.search_placeholder": { en: "Search anime title", vi: "Tim ten anime" },
  "discover.anime": { en: "Anime", vi: "Anime" },

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
  "steam_detail.show_price_details": { en: "Show price details", vi: "Xem chi tiet gia" },
  "steam_detail.refresh_dlc_title": { en: "Refresh DLC data", vi: "Lam moi du lieu DLC" },
  "steam_detail.refresh": { en: "Refresh", vi: "Lam moi" },
  "news.open_article": { en: "Open news article", vi: "Mo bai viet tin tuc" },
  "properties.current_location": { en: "Current Location", vi: "Vi tri hien tai" },
  "properties.new_location": { en: "New Location", vi: "Vi tri moi" },
  "properties.select_destination": { en: "Select destination folder...", vi: "Chon thu muc dich..." },

  // Download statuses
  "download.status.queued": { en: "Queued", vi: "Dang xep hang" },
  "download.status.cancelled": { en: "Cancelled", vi: "Da huy" },
};

const normalizeLocale = (value: string | null | undefined): Locale => {
  if (!value) return "en";
  const cleaned = value.replace("_", "-").toLowerCase();
  return cleaned.startsWith("vi") ? "vi" : "en";
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return normalizeLocale(stored);
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    fetchLocaleSettings()
      .then((data) => {
        if (!active) return;
        const resolved = normalizeLocale(data.locale || data.systemLocale);
        setLocaleState(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setLocale = (value: Locale) => {
    setLocaleState(value);
    updateLocaleSettings(value).catch(() => undefined);
  };

  const t = (key: string) => messages[key]?.[locale] || messages[key]?.en || key;

  const options = useMemo(
    () => [
      { value: "en" as const, label: t("locale.english"), shortLabel: "EN" },
      { value: "vi" as const, label: t("locale.vietnamese"), shortLabel: "VI" }
    ],
    [locale]
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

