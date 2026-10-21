<?php
/**
 * Plugin Name: Little Author Buddy Download
 * Description: Download page for Little Author Buddy. Put this folder in wp-content/plugins/ and add [little_author_buddy_download] to a page. Download buttons are filled from the latest GitHub release. The Linux button is the .deb. The AppImage is the Other Linux link.
 * Version: 1.0.0
 * Author: Epic-Problem-Solver
 *
 * The page markup is index.html in this folder. lw-character.css is read from
 * ../assets/lw-character.css (this repo) or ./assets/lw-character.css (a copy
 * beside this file). The SVG art is already inlined in index.html.
 * The browser never calls api.github.com. This plugin does, and caches the
 * result for one hour. If the API has no matching file, the button keeps the
 * stable /releases/latest/download/ name from index.html.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('LAB_DL_REPO', 'Epic-Problem-Solver/Little-Author-Buddy');

/**
 * @return array{windows:string,mac:string,appimage:string,deb:string,version:string}
 */
function lab_dl_latest() {
    $cached = get_transient('lab_dl_latest');
    if (is_array($cached)) {
        return $cached;
    }

    $empty = array(
        'windows' => '',
        'mac' => '',
        'appimage' => '',
        'deb' => '',
        'version' => '',
    );
    $response = wp_remote_get(
        'https://api.github.com/repos/' . LAB_DL_REPO . '/releases/latest',
        array(
            'timeout' => 8,
            'headers' => array(
                'Accept' => 'application/vnd.github+json',
                'User-Agent' => 'Little-Author-Buddy-Download',
            ),
        )
    );
    if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) {
        set_transient('lab_dl_latest', $empty, 10 * MINUTE_IN_SECONDS);
        return $empty;
    }

    $data = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($data)) {
        set_transient('lab_dl_latest', $empty, 10 * MINUTE_IN_SECONDS);
        return $empty;
    }

    $best = array(
        'windows' => null,
        'mac' => null,
        'appimage' => null,
        'deb' => null,
    );
    $assets = isset($data['assets']) && is_array($data['assets']) ? $data['assets'] : array();
    foreach ($assets as $asset) {
        $name = isset($asset['name']) ? (string) $asset['name'] : '';
        $url = lab_dl_safe_asset_url(isset($asset['browser_download_url']) ? (string) $asset['browser_download_url'] : '');
        if ($name === '' || $url === '') {
            continue;
        }
        if (preg_match('/\.AppImage$/i', $name)) {
            $best['appimage'] = lab_dl_prefer($best['appimage'], $name, $url, '/amd64|x86_64/i');
        } elseif (preg_match('/\.deb$/i', $name)) {
            $best['deb'] = lab_dl_prefer($best['deb'], $name, $url, '/amd64|x86_64/i');
        } elseif (preg_match('/\.dmg$/i', $name)) {
            $best['mac'] = lab_dl_prefer($best['mac'], $name, $url, '/universal/i');
        } elseif (preg_match('/-setup\.exe$/i', $name)) {
            $best['windows'] = lab_dl_prefer($best['windows'], $name, $url, '/x64|amd64/i');
        }
    }

    $out = $empty;
    $out['version'] = isset($data['tag_name']) ? (string) $data['tag_name'] : '';
    foreach ($best as $key => $pick) {
        if (is_array($pick)) {
            $out[$key] = $pick['url'];
        }
    }
    set_transient('lab_dl_latest', $out, HOUR_IN_SECONDS);
    return $out;
}

/**
 * @param array{name:string,url:string}|null $current
 * @return array{name:string,url:string}
 */
function lab_dl_prefer($current, $name, $url, $prefer) {
    $next = array('name' => $name, 'url' => $url);
    if ($current === null) {
        return $next;
    }
    $cur = preg_match($prefer, $current['name']) === 1;
    $neu = preg_match($prefer, $name) === 1;
    if ($neu && !$cur) {
        return $next;
    }
    return $current;
}

function lab_dl_safe_asset_url($url) {
    $url = esc_url_raw($url);
    if ($url === '') {
        return '';
    }
    $host = wp_parse_url($url, PHP_URL_HOST);
    if (!is_string($host)) {
        return '';
    }
    $host = strtolower($host);
    $github = $host === 'github.com' || substr($host, -strlen('.github.com')) === '.github.com';
    $assets = substr($host, -strlen('.githubusercontent.com')) === '.githubusercontent.com';
    if (!$github && !$assets) {
        return '';
    }
    return $url;
}

function lab_dl_css() {
    $paths = array(
        __DIR__ . '/../assets/lw-character.css',
        __DIR__ . '/assets/lw-character.css',
    );
    foreach ($paths as $path) {
        if (is_readable($path)) {
            $css = file_get_contents($path);
            if (is_string($css)) {
                return str_replace('</style', '<\\/style', $css);
            }
        }
    }
    return '';
}

function lab_dl_shortcode() {
    $path = __DIR__ . '/index.html';
    if (!is_readable($path)) {
        return '';
    }
    $raw = file_get_contents($path);
    if (!is_string($raw) || !preg_match('/<!-- lab:start -->(.*)<!-- lab:end -->/s', $raw, $match)) {
        return '';
    }
    $html = $match[1];
    $css = lab_dl_css();
    if ($css !== '') {
        $html = preg_replace(
            '#<link rel="stylesheet" href="[^"]*lw-character\\.css">#',
            '<style>' . $css . '</style>',
            $html,
            1
        );
    }

    $latest = lab_dl_latest();
    $stable = array(
        'windows' => 'https://github.com/' . LAB_DL_REPO . '/releases/latest/download/Little-Author-Buddy_0.8.0_x64-setup.exe',
        'mac' => 'https://github.com/' . LAB_DL_REPO . '/releases/latest/download/Little-Author-Buddy_0.8.0_universal.dmg',
        'appimage' => 'https://github.com/' . LAB_DL_REPO . '/releases/latest/download/Little-Author-Buddy_0.8.0_amd64.AppImage',
        'deb' => 'https://github.com/' . LAB_DL_REPO . '/releases/latest/download/Little-Author-Buddy_0.8.0_amd64.deb',
    );
    foreach ($stable as $key => $from) {
        if (!empty($latest[$key])) {
            $html = str_replace($from, esc_url($latest[$key]), $html);
        }
    }
    if (!empty($latest['version'])) {
        $html = str_replace(
            'The latest free release from GitHub.',
            'The latest free release from GitHub (' . esc_html($latest['version']) . ').',
            $html
        );
    }
    return $html;
}

add_shortcode('little_author_buddy_download', 'lab_dl_shortcode');
