// ==UserScript==
// @name         BUAA SPOC 换源刷课
// @namespace    http://tampermonkey.net/
// @version      3.3.0
// @description  北航 SPOC 平台：替换视频源为1秒短视频，骗过进度检测系统
// @match        *://spoc.buaa.edu.cn/*
// @match        *://*.spoc.buaa.edu.cn/*
// @match        *://spocvideo.spoc.buaa.edu.cn/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @connect      hw9.x-way.work
// ==/UserScript==

/**
 * 换源刷课方案：
 * - 每 500ms 检测页面中的 video 元素
 * - 若检测到且 src 不是目标替换视频，则把 src 换成 1 秒的短视频
 * - 视频瞬间播完，系统以为课程已看完
 *
 * 替换视频：https://hw9.x-way.work/misc/fuck-buaa/test.mp4 （约1秒）
 */

(function () {
    'use strict';

    console.log('[SPOC 换源] === 脚本已注入 ===');

    try {

    // ============ 配置 ============
    const REPLACEMENT_URL = 'https://hw9.x-way.work/misc/fuck-buaa/test2.mp4';
    const CHECK_INTERVAL = 500;        // 检测间隔（毫秒）
    const AUTO_PLAY = true;            // 换源后自动播放
    const MUTE = true;                 // 静音
    const AUTO_NEXT = true;            // 播完自动下一节

    const PLAYER_ID = 'myVideo';
    const VIDEO_ID = 'myVideo_html5_api';

    // ============ 工具函数 ============

    /** 获取 video 元素（主文档 + 同源 iframe） */
    function getVideo() {
        let v = document.getElementById(VIDEO_ID);
        if (v && v.tagName === 'VIDEO') return v;
        const player = document.getElementById(PLAYER_ID);
        if (player) {
            v = player.querySelector('video');
            if (v) return v;
        }
        v = document.querySelector('video.vjs-tech');
        if (v) return v;
        v = document.querySelector('video');
        if (v) return v;
        try {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!doc) continue;
                    v = doc.getElementById(VIDEO_ID)
                        || doc.querySelector('#' + PLAYER_ID + ' video')
                        || doc.querySelector('video.vjs-tech')
                        || doc.querySelector('video');
                    if (v) return v;
                } catch (e) { /* 跨域 iframe 跳过 */ }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** 获取 Video.js 播放器实例 */
    function getVideojsPlayer() {
        try {
            if (typeof videojs !== 'undefined' && videojs.getPlayer) {
                return videojs.getPlayer(PLAYER_ID) || videojs(PLAYER_ID);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** 判断 video 的 src 是否已经是替换视频 */
    function isAlreadyReplaced(video) {
        const src = video.src || video.getAttribute('src') || '';
        return src === REPLACEMENT_URL || src.indexOf('fuck-buaa/test.mp4') !== -1;
    }

    /** 替换视频源 */
    function replaceSource(video) {
        try {
            video.src = REPLACEMENT_URL;
            video.setAttribute('src', REPLACEMENT_URL);
        } catch (e) { /* ignore */ }

        const player = getVideojsPlayer();
        if (player && typeof player.src === 'function') {
            try {
                player.src({ src: REPLACEMENT_URL, type: 'video/mp4' });
            } catch (e) { /* ignore */ }
        }

        try {
            video.load();
        } catch (e) { /* ignore */ }

        if (AUTO_PLAY) {
            const p = video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }

        console.log('[SPOC 换源] 已替换视频源为:', REPLACEMENT_URL);
    }

    /** 静音 */
    function applyMute(video) {
        if (video && !video.muted) {
            try { video.muted = true; video.volume = 0; } catch (e) { /* ignore */ }
        }
        const player = getVideojsPlayer();
        if (player && typeof player.muted === 'function') {
            try { if (!player.muted()) player.muted(true); } catch (e) { /* ignore */ }
        }
    }

    /** 点击"下一节"按钮 */
    function clickNextLesson() {
        const selectors = [
            'a.next', 'button.next', '.next-btn', '.next-chapter',
            '#nextChapter', '#nextBtn', '#nextLesson',
            '.chapter-next', '.lesson-next', '.video-next',
            '[class*="next"]', '[id*="next"]',
        ];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                const text = (el.innerText || el.textContent || '').trim();
                if (/下(一)?(节|章|课|集|讲)/.test(text) || /next/i.test(text)) {
                    el.click();
                    return true;
                }
            }
        }
        const clickable = document.querySelectorAll('a, button, [role="button"], .el-button, .ant-btn');
        for (const el of clickable) {
            const text = (el.innerText || el.textContent || '').trim();
            if (/^下(一)?(节|章|课|集|讲)$/.test(text) || /^下一(节|章|课)/.test(text)) {
                el.click();
                return true;
            }
        }
        return false;
    }

    /** 绑定事件守卫：src 被改回时重新替换；播放结束自动下一节 */
    function bindGuard(video) {
        if (video.__spocGuardBound) return;
        video.__spocGuardBound = true;

        video.addEventListener('loadstart', () => {
            if (!isAlreadyReplaced(video)) {
                console.log('[SPOC 换源] 检测到 src 被重置，重新替换...');
                replaceSource(video);
            }
        });

        if (AUTO_NEXT) {
            video.addEventListener('ended', () => {
                console.log('[SPOC 换源] 视频播放结束，尝试进入下一节...');
                setTimeout(() => {
                    const ok = clickNextLesson();
                    if (!ok) console.log('[SPOC 换源] 未找到下一节按钮，可能已是最后一节');
                }, 800);
            });
        }
    }

    // ============ 主检测循环 ============

    let videoFound = false;

    function mainLoop() {
        const video = getVideo();
        if (!video) {
            if (videoFound) {
                videoFound = false;
            }
            return;
        }
        if (!videoFound) {
            console.log('[SPOC 换源] 找到 video 元素:', video.id || video.className);
            videoFound = true;
        }

        bindGuard(video);

        // 核心：只在 src 不是目标视频时才替换，避免反复 load 造成卡顿
        if (!isAlreadyReplaced(video)) {
            replaceSource(video);
        }

        if (MUTE) applyMute(video);
        if (AUTO_PLAY && video.paused && !video.ended) {
            const p = video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
    }

    setInterval(mainLoop, CHECK_INTERVAL);

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(mainLoop, 300);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(mainLoop, 300));
    }

    const observer = new MutationObserver(() => {
        mainLoop();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
        GM_registerMenuCommand('立即换源', () => {
            const video = getVideo();
            if (video) {
                replaceSource(video);
                alert('已替换视频源');
            } else {
                alert('未找到视频元素');
            }
        });
    } catch (e) { /* ignore */ }

    console.log('[SPOC 换源] 脚本已启动，替换目标:', REPLACEMENT_URL);

    } catch (e) {
        console.error('[SPOC 换源] 脚本运行出错:', e);
    }
})();
