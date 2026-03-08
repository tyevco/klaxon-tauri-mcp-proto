import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItemSchema, FormSchema, FormPage } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { FormFieldRenderer, validateField } from "../components/FormField";

function normalizePages(form: FormSchema): FormPage[] {
  if (form.pages && form.pages.length > 0) return form.pages;
  return [{ id: "__single__", fields: form.fields, next: { kind: "end" } }];
}

interface WizardState {
  itemId: string;
  form: FormSchema;
  pages: FormPage[];
  currentPageId: string;
  history: string[];
  values: Record<string, any>;
  errors: Record<string, string>;
}

function isLinear(pages: FormPage[]): boolean {
  return pages.every(p => !p.next || p.next.kind === "end" || p.next.kind === "fixed");
}

function ProgressDots({ pages, currentId, history }: { pages: FormPage[]; currentId: string; history: string[] }) {
  const visited = new Set([...history, currentId]);
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
      {pages.map(p => {
        const isCurrent = p.id === currentId;
        const isVisited = visited.has(p.id);
        return (
          <div
            key={p.id}
            style={{
              height: 6,
              width: isCurrent ? 20 : 8,
              borderRadius: 99,
              background: isCurrent ? "var(--info)" : isVisited ? "rgba(90,169,255,0.5)" : "var(--border)",
              transition: "width 0.2s",
            }}
          />
        );
      })}
    </div>
  );
}

export function FormWidget() {
  const [wizard, setWizard] = useState<WizardState | null>(null);

  useEffect(() => {
    const u1 = listen<{ id: string }>("form.open", async (event) => {
      const { id } = event.payload;
      try {
        const raw = await invoke("klaxon_get_item", { id });
        if (!raw) return;
        const item = KlaxonItemSchema.parse(raw);
        if (!item.form) return;
        const pages = normalizePages(item.form);
        setWizard({
          itemId: item.id,
          form: item.form,
          pages,
          currentPageId: pages[0].id,
          history: [],
          values: {},
          errors: {},
        });
      } catch (err) {
        console.error("[FormWidget] form.open error:", err);
      }
    });

    const u2 = listen<{ id: string }>("klaxon.answered", (event) => {
      setWizard(prev => {
        if (prev && prev.itemId === event.payload.id) return null;
        return prev;
      });
    });

    return () => {
      u1.then(u => u());
      u2.then(u => u());
    };
  }, []);

  if (!wizard) {
    return (
      <DraggablePanel id="form" title="Form" width={460}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>No active form.</div>
      </DraggablePanel>
    );
  }

  const currentPage = wizard.pages.find(p => p.id === wizard.currentPageId);
  if (!currentPage) {
    return (
      <DraggablePanel id="form" title="Form" width={460}>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Form error: page not found.</div>
      </DraggablePanel>
    );
  }

  const linear = isLinear(wizard.pages);
  const currentIdx = wizard.pages.findIndex(p => p.id === wizard.currentPageId);
  const totalPages = wizard.pages.length;

  async function handleNext() {
    if (!wizard || !currentPage) return;

    // Validate
    const nextErrors: Record<string, string> = {};
    for (const f of currentPage.fields) {
      const err = validateField(f, wizard.values[f.id]);
      if (err) nextErrors[f.id] = err;
    }
    if (Object.keys(nextErrors).length > 0) {
      setWizard({ ...wizard, errors: nextErrors });
      return;
    }

    const next = currentPage.next;

    // No next, end, or last page → submit
    if (!next || next.kind === "end" || !next) {
      await doSubmit();
      return;
    }

    if (next.kind === "fixed") {
      setWizard({
        ...wizard,
        history: [...wizard.history, wizard.currentPageId],
        currentPageId: next.page_id,
        errors: {},
      });
      return;
    }

    if (next.kind === "conditional") {
      const val = String(wizard.values[next.field_id] ?? "");
      const branch = next.branches.find(b => b.value === val);
      const targetId = branch?.page_id ?? next.default;
      if (targetId) {
        setWizard({
          ...wizard,
          history: [...wizard.history, wizard.currentPageId],
          currentPageId: targetId,
          errors: {},
        });
      } else {
        await doSubmit();
      }
      return;
    }
  }

  function handleBack() {
    if (!wizard || wizard.history.length === 0) return;
    const prev = wizard.history[wizard.history.length - 1];
    setWizard({
      ...wizard,
      history: wizard.history.slice(0, -1),
      currentPageId: prev,
      errors: {},
    });
  }

  async function doSubmit() {
    if (!wizard) return;
    try {
      await invoke("klaxon_answer", { id: wizard.itemId, response: wizard.values });
      await invoke("hide_panel", { label: "form" });
      setWizard(null);
    } catch (err) {
      console.error("[FormWidget] submit error:", err);
    }
  }

  async function handleCancel() {
    await invoke("hide_panel", { label: "form" });
    setWizard(null);
  }

  const isLastPage = !currentPage.next || currentPage.next.kind === "end"
    || (currentPage.next.kind !== "conditional" && !wizard.pages.find(p => p.id === (currentPage.next as any).page_id));
  const submitLabel = wizard.form.submitLabel ?? "Submit";
  const cancelLabel = wizard.form.cancelLabel ?? "Cancel";

  const title = wizard.form.title || "Form";

  return (
    <DraggablePanel id="form" title={title} width={460}>
      {wizard.form.description && (
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{wizard.form.description}</div>
      )}

      {linear && totalPages > 1 && (
        <ProgressDots pages={wizard.pages} currentId={wizard.currentPageId} history={wizard.history} />
      )}
      {!linear && (
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 10, textAlign: "center" }}>
          Step {currentIdx + 1}
        </div>
      )}
      {linear && totalPages > 1 && (
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6, textAlign: "center" }}>
          Step {currentIdx + 1} of {totalPages}
        </div>
      )}

      {currentPage.title && (
        <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 10 }}>{currentPage.title}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {currentPage.fields.map(f => (
          <FormFieldRenderer
            key={f.id}
            field={f}
            value={wizard.values[f.id]}
            error={wizard.errors[f.id]}
            onChange={v => setWizard({ ...wizard, values: { ...wizard.values, [f.id]: v } })}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {wizard.history.length > 0 && (
            <button onClick={handleBack} style={btnStyle()}>Back</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCancel} style={btnStyle()}>{cancelLabel}</button>
          <button onClick={handleNext} style={primaryBtnStyle()}>
            {isLastPage ? submitLabel : "Next →"}
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    background: "rgba(90, 169, 255, 0.18)",
    border: "1px solid rgba(90, 169, 255, 0.5)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
  };
}
