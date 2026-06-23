import { useI18n } from '../i18n/context';
import type { Locale } from '../i18n/translations';

interface HeaderProps {
  apiConnected: boolean;
}

/**
 * Application header with logo, title, language switcher, and API status.
 * @param props - Component props
 * @returns Header component
 */
const Header: React.FC<HeaderProps> = ({ apiConnected }) => {
  const { locale, setLocale, t } = useI18n();

  const toggleLocale = () => {
    const next: Locale = locale === 'en' ? 'zh' : 'en';
    setLocale(next);
  };

  return (
    <header className="glass-strong border-b border-cyan-500/15">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex h-14 sm:h-16 items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg font-bold text-xs sm:text-sm text-cyan-300 overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.2))',
                boxShadow: '0 0 15px rgba(6,182,212,0.2), inset 0 0 15px rgba(6,182,212,0.1)',
                border: '1px solid rgba(6,182,212,0.3)',
              }}
            >
              <span className="relative z-10 glow-text">AI</span>
              <div className="absolute inset-0 bg-linear-to-br from-cyan-500/10 to-blue-500/10" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-semibold text-white leading-tight tracking-tight truncate">
                {t.header.title}
              </h1>
              <p className="hidden sm:block text-xs text-slate-400 leading-tight truncate">
                {t.header.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              onClick={toggleLocale}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/50 bg-slate-800/50 px-2 sm:px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-cyan-500/30 hover:text-cyan-300 transition-all"
              title={locale === 'en' ? 'Switch to Chinese' : '切换到英文'}
            >
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {locale === 'en' ? '中文' : 'EN'}
            </button>

            <div
              className="flex items-center gap-2 text-sm"
              title={apiConnected ? t.header.apiConnected : t.header.apiOffline}
            >
              <span className="relative flex h-2 w-2">
                {apiConnected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${
                  apiConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]'
                }`} />
              </span>
              <span className="hidden sm:inline text-xs text-slate-400">
                {apiConnected ? t.header.apiConnected : t.header.apiOffline}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
