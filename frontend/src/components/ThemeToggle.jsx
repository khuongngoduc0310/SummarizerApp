import React from 'react';
import { Moon, Sun } from 'lucide-react';

const ThemeToggle = ({ theme = 'dark', onThemeChange, className = '' }) => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    const label = `Switch to ${nextTheme} theme`;
    const Icon = theme === 'light' ? Moon : Sun;

    return (
        <button
            type="button"
            onClick={() => onThemeChange?.(nextTheme)}
            aria-label={label}
            aria-pressed={theme === 'light'}
            title={label}
            className={`flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-200 shadow-sm transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 light:border-slate-500 light:bg-white light:text-slate-700 light:hover:bg-slate-100 light:hover:text-slate-950 ${className}`}
        >
            <Icon size={18} aria-hidden="true" />
            <span className="sr-only">{label}</span>
        </button>
    );
};

export default React.memo(ThemeToggle);
