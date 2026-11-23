import { Check, Database, Languages, Moon, Palette, RotateCcw, Sun, Type } from 'lucide-react';
import { retroText } from '../i18n/messages';
import { usePreferences } from '../preferences/PreferencesProvider';
import { defaultPreferences, englishFonts, palettes, persianFonts, type Density, type EnglishFont, type PersianFont } from '../preferences/config';
import { useWorkspace } from '../lib/Workspace';
import { Button, Field, Modal } from './ui';

export function AppearanceSettings() {
  const { preferences, setPreferences, language, setLanguage, setPalette, mode, t } = usePreferences();
  const { name, setName, density, setDensity, readingSize, setReadingSize, focusMode, setFocusMode, closeModal, notify } = useWorkspace();
  return (
    <Modal title={t('appearanceTitle')} subtitle={t('appearanceSubtitle')} onClose={closeModal} className="appearance-dialog">
      <div className="appearance-content">
        <section className="preference-section" aria-labelledby="palette-heading">
          <div className="preference-section-title"><Palette size={17}/><h3 id="palette-heading">{t('palette')}</h3></div>
          <p>{t('paletteHint')}</p>
          <div className="palette-options" role="group" aria-label={t('palette')}>
            {palettes.map(palette => (
              <button key={palette.id} data-autofocus={preferences.palette === palette.id ? 'true' : undefined} className={`palette-option ${preferences.palette === palette.id ? 'selected' : ''}`} aria-pressed={preferences.palette === palette.id} onClick={() => setPalette(palette.id)}>
                <span className="palette-swatch" aria-hidden="true">{palette.swatches.map(color => <i key={color} style={{ backgroundColor: color }}/>)}</span>
                <span>{t(palette.name)}</span>{preferences.palette === palette.id && <Check size={13}/>}
              </button>
            ))}
          </div>
          <div className="palette-theory">{t(palettes.find(palette => palette.id === preferences.palette)!.description)}</div>
          <div className="mode-row">
            <div className="preference-segment" role="group" aria-label={t('toggleMode', { mode: t(mode) })}>
              {(['light', 'dark'] as const).map(item => <button key={item} className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => setPreferences(previous => ({ ...previous, modes: { ...previous.modes, [previous.palette]: item } }))}>{item === 'light' ? <Sun size={16}/> : <Moon size={16}/>} {t(item)}</button>)}
            </div>
            <small>{t('paletteModeHint')}</small>
          </div>
        </section>
        <section className="preference-section" aria-labelledby="language-heading">
          <div className="preference-section-title"><Languages size={17}/><h3 id="language-heading">{t('language')}</h3></div>
          <div className="preference-segment" role="group" aria-label={t('language')}>
            <button lang="en" dir="ltr" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English <small>LTR</small></button>
            <button lang="fa" dir="rtl" className={retroText(language, '', 'active')} aria-pressed={language === 'fa'} onClick={() => setLanguage('fa')}>فارسی <small>RTL</small></button>
          </div>
        </section>
        <section className="preference-section" aria-labelledby="fonts-heading">
          <div className="preference-section-title"><Type size={17}/><h3 id="fonts-heading">{t('englishFont')} / {t('persianFont')}</h3></div>
          <div className="font-options-grid">
            <div><Field label={t('englishFont')}><select value={preferences.englishFont} onChange={event => setPreferences(previous => ({ ...previous, englishFont: event.target.value as EnglishFont }))}>{Object.entries(englishFonts).map(([key, font]) => <option key={key} value={key}>{t(font.label)}</option>)}</select></Field><div className="font-sample font-sample--en" lang="en" dir="ltr">{t('fontPreviewEn')}</div></div>
            <div><Field label={t('persianFont')}><select value={preferences.persianFont} onChange={event => setPreferences(previous => ({ ...previous, persianFont: event.target.value as PersianFont }))}>{Object.entries(persianFonts).map(([key, font]) => <option key={key} value={key}>{t(font.label)}</option>)}</select></Field><div className="font-sample font-sample--fa" lang="fa" dir="rtl">{t('fontPreviewFa')}</div></div>
          </div>
        </section>
        <section className="preference-section" aria-labelledby="layout-heading">
          <div className="preference-section-title"><h3 id="layout-heading">{t('layout')}</h3></div>
          <Field label={t('yourName')}><input dir="auto" value={name} onChange={event => setName(event.target.value)} maxLength={30} onBlur={() => { if (!name.trim()) setName('James'); }}/></Field>
          <Field label={t('layout')}><select value={density} onChange={event => setDensity(event.target.value as Density)}>{(['adaptive', 'compact', 'comfortable'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
          <p className="preference-hint">{t('layoutHint')}</p>
          <div className="preference-switches">
            <label><input type="checkbox" checked={readingSize} onChange={event => setReadingSize(event.target.checked)}/><span><strong>{t('largerText')}</strong><small>{t('readingHint')}</small></span></label>
            <label><input type="checkbox" checked={focusMode} onChange={event => setFocusMode(event.target.checked)}/><span><strong>{t('focusMode')}</strong><small>{t('focusHint')}</small></span></label>
          </div>
          <div className="form-note"><Database size={20}/><p><strong>{t('localDemoTitle')}</strong>{t('localDemoBody')}</p></div>
        </section>
      </div>
      <div className="appearance-footer"><span><Check size={13}/>{t('previewLive')}</span><div><Button small onClick={() => { setPreferences({ ...defaultPreferences, language }); setDensity('adaptive'); setReadingSize(false); setFocusMode(false); notify(t('resetAppearanceDone')); }}><RotateCcw size={13}/>{t('resetAppearance')}</Button><Button variant="primary" onClick={closeModal}>{t('done')}<Check size={14}/></Button></div></div>
    </Modal>
  );
}