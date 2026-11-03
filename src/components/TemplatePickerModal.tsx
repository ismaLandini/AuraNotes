import { BookOpen, Calculator, FileSpreadsheet, Sparkles } from 'lucide-react';
import { useUI, toast } from '../store/ui';
import { useStore } from '../store/useStore';
import { ACADEMIC_TEMPLATES, type AcademicTemplateId } from '../model/templates';
import { Modal } from './Dialogs';

const ICONS: Record<AcademicTemplateId, typeof BookOpen> = {
  cornell: BookOpen,
  exercise: Calculator,
  cheatsheet: FileSpreadsheet,
};

export function TemplatePickerModal() {
  const open = useUI((s) => s.templatePickerOpen);
  const close = () => useUI.getState().set({ templatePickerOpen: false });

  if (!open) return null;

  const handleSelect = (id: AcademicTemplateId, title: string) => {
    const pid = useStore.getState().addPage(undefined, undefined, id);
    close();
    if (pid) {
      toast(`Pagina creata con template "${title}"`, 'success', 2000);
    }
  };

  return (
    <Modal title="Scegli un template accademico" onClose={close} wide testid="template-picker-modal">
      <div className="template-picker-content">
        <p className="template-picker-lead">
          Inizia rapidamente con layout strutturati studiati per lezioni universitarie, esercizi STEM e formulari d'esame.
        </p>

        <div className="template-cards-grid">
          {ACADEMIC_TEMPLATES.map((tmpl) => {
            const Icon = ICONS[tmpl.id] || Sparkles;
            return (
              <div
                key={tmpl.id}
                className="template-card glass"
                onClick={() => handleSelect(tmpl.id, tmpl.title)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(tmpl.id, tmpl.title);
                  }
                }}
              >
                <div className="template-card-header">
                  <div className="template-card-icon">
                    <Icon size={20} />
                  </div>
                  <span className="template-badge">{tmpl.badge}</span>
                </div>
                <h3 className="template-card-title">{tmpl.title}</h3>
                <p className="template-card-desc">{tmpl.description}</p>
                <div className="template-card-footer">
                  <button
                    className="btn sm primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(tmpl.id, tmpl.title);
                    }}
                  >
                    Usa template
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
