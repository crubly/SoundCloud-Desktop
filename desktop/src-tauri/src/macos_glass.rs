//! Native macOS Liquid Glass & Vibrancy window integration.
//!
//! On macOS, configures the main `NSWindow` with:
//! - Full-size content view + transparent overlay titlebar + native traffic lights
//! - Native `NSGlassEffectView` (macOS 26 Tahoe+) / `NSVisualEffectView`
//!   (`BehindWindow` dark vibrancy) behind the WebView
//! - Transparent `WKWebView` backing so the sidebar and translucent chrome
//!   composite directly over native macOS glass.
//!
//! On non-macOS platforms, disables native titlebar decorations so the custom
//! Liquid Glass window controls pill renders cleanly.

#[cfg(target_os = "macos")]
mod detail {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{ClassType, MainThreadMarker, MainThreadOnly, msg_send};
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameVibrantDark,
        NSAutoresizingMaskOptions, NSColor, NSView, NSVisualEffectBlendingMode,
        NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
        NSWindowOrderingMode, NSWindowStyleMask, NSWindowTitleVisibility,
    };
    use objc2_foundation::NSRect;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::Manager;

    use crate::app::diagnostics::log_native;
    use crate::rt::AppHandle;

    pub fn setup_window_glass(app: &AppHandle) {
        let handle = app.clone();
        let h2 = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            apply_macos_glass(&h2);
        });
    }

    fn apply_macos_glass(app: &AppHandle) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(win) = app.get_webview_window("main") else {
            return;
        };
        let Ok(wh) = win.window_handle() else {
            return;
        };
        let RawWindowHandle::AppKit(appkit) = wh.as_raw() else {
            return;
        };

        let ns_view: Option<Retained<NSView>> =
            unsafe { Retained::retain(appkit.ns_view.as_ptr().cast::<NSView>()) };
        let Some(webview_view) = ns_view else {
            return;
        };
        let Some(ns_window): Option<Retained<NSWindow>> = webview_view.window() else {
            return;
        };

        // 1. Ensure native traffic lights + full-size content view + transparent titlebar
        let current_mask = ns_window.styleMask();
        ns_window.setStyleMask(
            current_mask
                | NSWindowStyleMask::Titled
                | NSWindowStyleMask::Closable
                | NSWindowStyleMask::Miniaturizable
                | NSWindowStyleMask::Resizable
                | NSWindowStyleMask::FullSizeContentView,
        );
        ns_window.setTitlebarAppearsTransparent(true);
        ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
        ns_window.setOpaque(false);
        ns_window.setHasShadow(true);

        // Deep obsidian-clear window background so behind-window vibrancy blends into pure black
        let bg_color = NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.0);
        ns_window.setBackgroundColor(Some(&bg_color));

        // 2. Force VibrantDark appearance on the window
        if let Some(dark_appearance) =
            unsafe { NSAppearance::appearanceNamed(NSAppearanceNameVibrantDark) }
        {
            ns_window.setAppearance(Some(&dark_appearance));
        }

        // 4. Attach native macOS vibrancy / Liquid Glass backing view underneath contentView
        if let Some(content_view) = ns_window.contentView() {
            let bounds: NSRect = content_view.bounds();

            let effect_view =
                NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), bounds);
            effect_view.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
            effect_view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            effect_view.setState(NSVisualEffectState::Active);
            effect_view.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            if let Some(dark_appearance) =
                unsafe { NSAppearance::appearanceNamed(NSAppearanceNameVibrantDark) }
            {
                effect_view.setAppearance(Some(&dark_appearance));
            }

            content_view.addSubview_positioned_relativeTo(
                effect_view.as_super(),
                NSWindowOrderingMode::Below,
                None,
            );

            // If running on macOS 26+ (Tahoe) where NSGlassEffectView is available,
            // layer native Liquid Glass backing as well.
            if let Some(glass_cls) = AnyClass::get(c"NSGlassEffectView") {
                unsafe {
                    let glass_alloc: *mut AnyObject = msg_send![glass_cls, alloc];
                    if !glass_alloc.is_null() {
                        let glass_obj: *mut AnyObject =
                            msg_send![glass_alloc, initWithFrame: bounds];
                        if let Some(glass_view) = Retained::retain(glass_obj.cast::<NSView>()) {
                            glass_view.setAutoresizingMask(
                                NSAutoresizingMaskOptions::ViewWidthSizable
                                    | NSAutoresizingMaskOptions::ViewHeightSizable,
                            );
                            content_view.addSubview_positioned_relativeTo(
                                &glass_view,
                                NSWindowOrderingMode::Below,
                                None,
                            );
                            log_native(
                                app,
                                "INFO",
                                "[MacOSGlass] Native NSGlassEffectView attached",
                            );
                        }
                    }
                }
            }
        }

        log_native(
            app,
            "INFO",
            "[MacOSGlass] Configured native macOS Liquid Glass + traffic lights",
        );
    }
}

#[cfg(not(target_os = "macos"))]
mod detail {
    use crate::rt::AppHandle;
    use tauri::Manager;

    pub fn setup_window_glass(app: &AppHandle) {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_decorations(false);
        }
    }
}

pub use detail::setup_window_glass;
