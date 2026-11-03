import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  RotateCcw,
} from 'lucide-react';
import {
  getParagraphFormatState,
  type ParagraphFormatAttrs,
} from '../editor/paragraphFormat';
import { useActiveEditor } from '../editor/activeEditor';

interface Props {
  editor?: Editor | null;
  close?: () => void;
}

const LINE_HEIGHT_PRESETS = ['1.0', '1.15', '1.5', '2.0'];

function StepperField({
  label,
  value,
  onChange,
  min = 0,
  max = 200,
  step = 1,
  unit = 'pt',
  disabled,
}: {
  label: string;
  value: number | null | 'mixed';
  onChange: (val: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const isMixed = value === 'mixed';
  const displayVal = isMixed ? '' : value != null ? String(value) : '';

  const handleStep = (delta: number) => {
    const cur = isMixed || value == null ? 0 : value;
    const next = Math.max(min, Math.min(max, Math.round((cur + delta) * 100) / 100));
    onChange(next);
  };

  return (
    <div className="paragraph-field">
      <span className="paragraph-field-label">{label}</span>
      <div className="paragraph-stepper-wrap">
        <input
          type={isMixed ? 'text' : 'number'}
          className={`paragraph-stepper-input${isMixed ? ' is-mixed' : ''}`}
          value={displayVal}
          placeholder={isMixed ? 'Misto' : '0'}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              onChange(null);
            } else {
              const num = parseFloat(raw);
              if (!isNaN(num)) {
                onChange(Math.max(min, Math.min(max, num)));
              }
            }
          }}
        />
        {unit && <span className="paragraph-stepper-unit">{unit}</span>}
        <div className="paragraph-stepper-controls">
          <button
            type="button"
            tabIndex={-1}
            className="paragraph-step-btn"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => handleStep(step)}
            title="Aumenta"
            aria-label={`Aumenta ${label}`}
          >
            ▲
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="paragraph-step-btn"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => handleStep(-step)}
            title="Riduci"
            aria-label={`Riduci ${label}`}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  );
}

export function ParagraphPanel({ editor }: Props) {
  useActiveEditor((s) => s.tick);

  const state = getParagraphFormatState(editor);
  const [customLhSelected, setCustomLhSelected] = useState(false);

  const updateAttrs = useCallback(
    (attrs: Partial<ParagraphFormatAttrs>) => {
      if (!editor || editor.isDestroyed) return;
      editor.commands.setParagraphFormat(attrs);
    },
    [editor],
  );

  const handleReset = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.resetParagraphFormat();
    setCustomLhSelected(false);
  }, [editor, setCustomLhSelected]);

  // Determine line height dropdown value
  const isLhMixed = state.lineHeight === 'mixed';
  const isLhCustomVal =
    !isLhMixed &&
    state.lineHeight !== null &&
    !LINE_HEIGHT_PRESETS.includes(state.lineHeight);
  const showCustomLhInput = customLhSelected || isLhCustomVal;

  let lhDropdownVal = 'auto';
  if (isLhMixed) {
    lhDropdownVal = 'mixed';
  } else if (showCustomLhInput) {
    lhDropdownVal = 'custom';
  } else if (state.lineHeight !== null && LINE_HEIGHT_PRESETS.includes(state.lineHeight)) {
    lhDropdownVal = state.lineHeight;
  }

  const disabled = !editor;

  return (
    <div className="paragraph-panel" data-testid="paragraph-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="paragraph-panel-header">
        <span className="paragraph-panel-title">Paragrafo</span>
      </div>

      {/* 1. Allineamento */}
      <div className="paragraph-section">
        <span className="paragraph-section-label">Allineamento</span>
        <div className="paragraph-btn-group" role="group" aria-label="Allineamento">
          <button
            type="button"
            className={`paragraph-align-btn${state.textAlign === 'left' ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => updateAttrs({ textAlign: 'left' })}
            title="Allinea a sinistra"
            aria-label="Allinea a sinistra"
            aria-pressed={state.textAlign === 'left'}
          >
            <AlignLeft size={16} />
          </button>
          <button
            type="button"
            className={`paragraph-align-btn${state.textAlign === 'center' ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => updateAttrs({ textAlign: 'center' })}
            title="Centra"
            aria-label="Centra"
            aria-pressed={state.textAlign === 'center'}
          >
            <AlignCenter size={16} />
          </button>
          <button
            type="button"
            className={`paragraph-align-btn${state.textAlign === 'right' ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => updateAttrs({ textAlign: 'right' })}
            title="Allinea a destra"
            aria-label="Allinea a destra"
            aria-pressed={state.textAlign === 'right'}
          >
            <AlignRight size={16} />
          </button>
          <button
            type="button"
            className={`paragraph-align-btn${state.textAlign === 'justify' ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => updateAttrs({ textAlign: 'justify' })}
            title="Giustifica"
            aria-label="Giustifica"
            aria-pressed={state.textAlign === 'justify'}
          >
            <AlignJustify size={16} />
          </button>
        </div>
      </div>

      {/* 2. Interlinea */}
      <div className="paragraph-section">
        <span className="paragraph-section-label">Interlinea</span>
        <div className="paragraph-row">
          <select
            className="paragraph-select"
            value={lhDropdownVal}
            disabled={disabled}
            aria-label="Interlinea"
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'custom') {
                setCustomLhSelected(true);
                if (state.lineHeight === null || isLhMixed || !isLhCustomVal) {
                  updateAttrs({ lineHeight: '1.25' });
                }
              } else {
                setCustomLhSelected(false);
                if (val === 'auto') {
                  updateAttrs({ lineHeight: null });
                } else if (val !== 'mixed') {
                  updateAttrs({ lineHeight: val });
                }
              }
            }}
          >
            {isLhMixed && <option value="mixed">Misto</option>}
            <option value="auto">Predefinita</option>
            <option value="1.0">1.0 (Singola)</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5</option>
            <option value="2.0">2.0 (Doppia)</option>
            <option value="custom">Personalizzata…</option>
          </select>

          {showCustomLhInput && (
            <div className="paragraph-stepper-wrap lh-custom-wrap">
              <input
                type="number"
                className="paragraph-stepper-input"
                min={0.5}
                max={5.0}
                step={0.05}
                value={isLhMixed ? '' : state.lineHeight || '1.25'}
                placeholder={isLhMixed ? 'Misto' : '1.25'}
                disabled={disabled}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw !== '') {
                    const num = parseFloat(raw);
                    if (!isNaN(num) && num > 0) {
                      updateAttrs({ lineHeight: String(num) });
                    }
                  }
                }}
              />
              <div className="paragraph-stepper-controls">
                <button
                  type="button"
                  tabIndex={-1}
                  className="paragraph-step-btn"
                  disabled={disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    const cur = state.lineHeight ? parseFloat(state.lineHeight) : 1.25;
                    const next = Math.round((cur + 0.05) * 100) / 100;
                    updateAttrs({ lineHeight: String(next) });
                  }}
                  title="Aumenta"
                >
                  ▲
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className="paragraph-step-btn"
                  disabled={disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    const cur = state.lineHeight ? parseFloat(state.lineHeight) : 1.25;
                    const next = Math.max(0.5, Math.round((cur - 0.05) * 100) / 100);
                    updateAttrs({ lineHeight: String(next) });
                  }}
                  title="Riduci"
                >
                  ▼
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Spazio prima e dopo il paragrafo (in pt) */}
      <div className="paragraph-section">
        <span className="paragraph-section-label">Spaziatura paragrafo</span>
        <div className="paragraph-grid-2">
          <StepperField
            label="Prima"
            value={state.spaceBefore}
            onChange={(v) => updateAttrs({ spaceBefore: v })}
            min={0}
            max={200}
            step={1}
            disabled={disabled}
          />
          <StepperField
            label="Dopo"
            value={state.spaceAfter}
            onChange={(v) => updateAttrs({ spaceAfter: v })}
            min={0}
            max={200}
            step={1}
            disabled={disabled}
          />
        </div>
      </div>

      {/* 4. Rientro: sinistro e prima riga (in pt) */}
      <div className="paragraph-section">
        <span className="paragraph-section-label">Rientro</span>
        <div className="paragraph-grid-2">
          <StepperField
            label="Sinistro"
            value={state.leftIndent}
            onChange={(v) => updateAttrs({ leftIndent: v })}
            min={0}
            max={300}
            step={1}
            disabled={disabled}
          />
          <StepperField
            label="Prima riga"
            value={state.firstLineIndent}
            onChange={(v) => updateAttrs({ firstLineIndent: v })}
            min={-100}
            max={300}
            step={1}
            disabled={disabled}
          />
        </div>
      </div>

      {/* 5. Spaziatura tra i caratteri (letter-spacing, in pt) */}
      <div className="paragraph-section">
        <StepperField
          label="Spaziatura caratteri"
          value={state.letterSpacing}
          onChange={(v) => updateAttrs({ letterSpacing: v })}
          min={-5}
          max={30}
          step={0.5}
          disabled={disabled}
        />
      </div>

      {/* 6. Ripristina predefiniti */}
      <div className="paragraph-footer">
        <button
          type="button"
          className="paragraph-reset-btn"
          disabled={disabled}
          onClick={handleReset}
          title="Ripristina valori predefiniti del paragrafo"
        >
          <RotateCcw size={13} />
          <span>Ripristina predefiniti</span>
        </button>
      </div>
    </div>
  );
}
