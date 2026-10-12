/**
 * 站点匹配分层配置（单一维护点）
 *
 * L1 Manifest：宽匹配，负责「能否注入」content script（见 manifest.json）
 * L2 本文件：运行时白名单，负责「是否允许开监控」+ 明确报错
 * L3 业务选择器：仍在 content.js，与域名无关
 *
 * 以后域名再变：优先只改 hostRules / knownHosts，不必写死完整主机名到业务逻辑。
 */
(function (root) {
    const NoonSiteConfig = {
        /** 允许的主机：后缀匹配，避免写死单一子域 */
        hostRules: [
            { type: 'suffix', value: '.noon.partners' },
            { type: 'exact', value: 'noon.partners' }
        ],

        /**
         * 预约页路径形态（新旧都兼容）
         * 新：/en-sa/asn/A06180569PN/schedule
         * 旧：/en-sa/asn/schedule/...
         */
        pathRules: [
            /\/asn\/[^/]+\/schedule(?:\/|$)/i,
            /\/asn\/schedule(?:\/|$)/i
        ],

        /** 已知宿主，仅用于提示文案，不参与硬拦截 */
        knownHosts: [
            'fbn.noon.partners',
            'fbn-inbound.noon.partners'
        ],

        matchHost(hostname) {
            const host = String(hostname || '').toLowerCase();
            if (!host) {
                return { ok: false, reason: 'empty_host' };
            }

            for (const rule of this.hostRules) {
                if (rule.type === 'exact' && host === rule.value) {
                    return { ok: true, host };
                }
                if (rule.type === 'suffix' && (host === rule.value.slice(1) || host.endsWith(rule.value))) {
                    return { ok: true, host };
                }
            }

            return { ok: false, reason: 'host_mismatch', host };
        },

        matchPath(pathname) {
            const path = String(pathname || '');
            for (const rule of this.pathRules) {
                if (rule.test(path)) {
                    return { ok: true, path };
                }
            }
            return { ok: false, reason: 'path_mismatch', path };
        },

        /**
         * @returns {{ ok: boolean, host?: string, path?: string, reason?: string, message: string }}
         */
        matchUrl(urlString) {
            let url;
            try {
                url = new URL(urlString);
            } catch (e) {
                return {
                    ok: false,
                    reason: 'invalid_url',
                    message: '当前标签页不是有效网页，请先打开 Noon ASN 预约页。'
                };
            }

            if (url.protocol !== 'https:') {
                return {
                    ok: false,
                    reason: 'protocol',
                    message: '仅支持 https 预约页。'
                };
            }

            const hostResult = this.matchHost(url.hostname);
            if (!hostResult.ok) {
                const hint = this.knownHosts.join('、');
                return {
                    ok: false,
                    reason: hostResult.reason,
                    host: hostResult.host,
                    message: `当前域名不在白名单：${hostResult.host || '(空)'}。已知示例：${hint}。若官方又换子域，请在 site-config.js 的 hostRules 中追加后缀规则。`
                };
            }

            const pathResult = this.matchPath(url.pathname);
            if (!pathResult.ok) {
                return {
                    ok: false,
                    reason: pathResult.reason,
                    host: hostResult.host,
                    path: pathResult.path,
                    message: `已打开 Noon 站点，但不是 ASN 预约页（路径：${pathResult.path}）。请打开 Book a slot / schedule 页面后再启动。`
                };
            }

            return {
                ok: true,
                host: hostResult.host,
                path: pathResult.path,
                message: 'ok'
            };
        },

        /** 从 URL 推断 ae / sa，供 popup 默认仓库提示 */
        detectRegion(urlString) {
            const text = String(urlString || '').toLowerCase();
            if (text.includes('-ae') || text.includes('/en-ae/')) return 'ae';
            if (text.includes('-sa') || text.includes('/en-sa/')) return 'sa';
            return null;
        },

        /**
         * 四店预设（与 apps/api/config/shop-prefix-map.json 对齐）
         * 店1 HUI Beauty / 店2 HFY-KSA / 店3 Glam Bag / 店4 mmm
         */
        shopPresets: [
            { prefix: 'N1', label: '店1', name: 'HUI Beauty', projectCode: 'PRJ396770' },
            { prefix: 'N2', label: '店2', name: 'HFY-KSA', projectCode: 'PRJ482387' },
            { prefix: 'N3', label: '店3', name: 'Glam Bag Collection', projectCode: 'PRJ488078' },
            { prefix: 'N4', label: '店4', name: 'mmm', projectCode: 'PRJ595165' }
        ],

        findShopPreset(opts) {
            const prefix = String(opts && opts.prefix || '').toUpperCase();
            const project = String(opts && opts.projectCode || '').trim().toUpperCase();
            const name = String(opts && opts.name || '').trim().toLowerCase();
            if (prefix) {
                const hit = this.shopPresets.find((s) => s.prefix === prefix);
                if (hit) return hit;
            }
            if (project) {
                const hit = this.shopPresets.find((s) => s.projectCode.toUpperCase() === project);
                if (hit) return hit;
            }
            if (name) {
                const hit = this.shopPresets.find((s) => s.name.toLowerCase() === name);
                if (hit) return hit;
            }
            return null;
        },

        /** URL ?project=PRJ396770 */
        detectProjectCode(urlString) {
            try {
                const url = new URL(urlString || '');
                const q = url.searchParams.get('project') || url.searchParams.get('projectCode');
                if (q && /^PRJ\d+/i.test(q)) return q.toUpperCase();
                const m = String(urlString || '').match(/[?&#]project=(PRJ\d+)/i);
                return m ? m[1].toUpperCase() : null;
            } catch (e) {
                return null;
            }
        },

        /**
         * 识别当前页店铺：优先 URL project=，其次页头店名文案
         * @returns {{ prefix, label, name, projectCode, source } | null}
         */
        detectPageShop(urlString, doc) {
            const projectCode = this.detectProjectCode(urlString);
            if (projectCode) {
                const preset = this.findShopPreset({ projectCode });
                if (preset) return { ...preset, source: 'url' };
            }

            const root = doc || (typeof document !== 'undefined' ? document : null);
            if (!root) return null;
            const headerText = [
                root.querySelector('header')?.innerText,
                root.querySelector('[class*="header"]')?.innerText,
                root.querySelector('nav')?.innerText
            ].filter(Boolean).join('\n');

            for (const preset of this.shopPresets) {
                if (headerText && headerText.includes(preset.name)) {
                    return { ...preset, source: 'header' };
                }
            }
            return null;
        }
    };

    root.NoonSiteConfig = NoonSiteConfig;
})(typeof globalThis !== 'undefined' ? globalThis : window);
