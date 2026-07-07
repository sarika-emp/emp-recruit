import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Eraser,
  Undo,
  Redo,
} from "lucide-react";

interface RichTextEditorProps {
  /** Current HTML value (controlled). */
  value: string;
  /** Called with the new HTML whenever the content changes. */
  onChange: (html: string) => void;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * A lightweight, dependency-free rich-text editor styled to look and behave
 * like a classic CKEditor: a toolbar of formatting controls over a WYSIWYG
 * editable area. It emits HTML, which is what job descriptions are stored and
 * rendered as across the app (the career page uses dangerouslySetInnerHTML).
 *
 * It intentionally uses document.execCommand — deprecated but still supported
 * in every browser — to avoid pulling in a heavy editor dependency. Rendered
 * content should carry the `rte-content` class (see globals.css) so lists and
 * headings survive Tailwind's preflight reset.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  id,
  "aria-label": ariaLabel,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [active, setActive] = useState<Record<string, boolean>>({});

  const isEmpty = (el: HTMLElement) =>
    el.textContent?.trim() === "" && !el.querySelector("img, hr, table, li");

  // Sync the external value into the editable div WITHOUT disturbing the caret
  // during typing. We only write when the incoming value differs from what's
  // already in the DOM — true on mount and when async data (an existing job in
  // edit mode) arrives, but not while the user types (onInput echoes the same
  // HTML straight back up, so value === innerHTML and this no-ops).
  useEffect(() => {
    const el = ref.current;
    if (el && value !== el.innerHTML) {
      el.innerHTML = value || "";
      setEmpty(isEmpty(el));
    }
  }, [value]);

  // Reflect the caret's current formatting on the toolbar (bold active, etc.).
  const syncActive = useCallback(() => {
    if (!ref.current) return;
    const q = (cmd: string) => {
      try {
        return document.queryCommandState(cmd);
      } catch {
        return false;
      }
    };
    let block = "";
    try {
      block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
    } catch {
      /* not supported — leave headings inactive */
    }
    setActive({
      bold: q("bold"),
      italic: q("italic"),
      underline: q("underline"),
      strikeThrough: q("strikeThrough"),
      insertUnorderedList: q("insertUnorderedList"),
      insertOrderedList: q("insertOrderedList"),
      h2: block === "h2",
      h3: block === "h3",
    });
  }, []);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEmpty(isEmpty(el));
    onChange(el.innerHTML);
    syncActive();
  }, [onChange, syncActive]);

  // Keep toolbar state fresh as the selection moves, but only while focused.
  useEffect(() => {
    if (!focused) return;
    document.addEventListener("selectionchange", syncActive);
    return () => document.removeEventListener("selectionchange", syncActive);
  }, [focused, syncActive]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const toggleBlock = (tag: "h2" | "h3") => {
    let cur = "";
    try {
      cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
    } catch {
      /* noop */
    }
    exec("formatBlock", cur === tag ? "<p>" : `<${tag}>`);
  };

  const addLink = () => {
    const url = window.prompt("Enter the link URL");
    if (url) exec("createLink", url.trim());
  };

  const btn =
    "flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-200 disabled:opacity-40";
  const btnActive = "bg-brand-100 text-brand-700 hover:bg-brand-200";

  const Btn = ({
    onClick,
    label,
    isActive,
    children,
  }: {
    onClick: () => void;
    label: string;
    isActive?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      // Prevent the button from stealing focus/selection from the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`${btn} ${isActive ? btnActive : ""}`}
    >
      {children}
    </button>
  );

  const Divider = () => <span className="mx-0.5 h-5 w-px bg-gray-300" />;

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition ${
        focused ? "border-brand-500 ring-1 ring-brand-500" : "border-gray-300"
      }`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
        <Btn onClick={() => exec("bold")} label="Bold" isActive={active.bold}>
          <Bold className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => exec("italic")} label="Italic" isActive={active.italic}>
          <Italic className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => exec("underline")} label="Underline" isActive={active.underline}>
          <Underline className="h-4 w-4" />
        </Btn>
        <Btn
          onClick={() => exec("strikeThrough")}
          label="Strikethrough"
          isActive={active.strikeThrough}
        >
          <Strikethrough className="h-4 w-4" />
        </Btn>
        <Divider />
        <Btn onClick={() => toggleBlock("h2")} label="Heading" isActive={active.h2}>
          <Heading2 className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => toggleBlock("h3")} label="Subheading" isActive={active.h3}>
          <Heading3 className="h-4 w-4" />
        </Btn>
        <Divider />
        <Btn
          onClick={() => exec("insertUnorderedList")}
          label="Bulleted list"
          isActive={active.insertUnorderedList}
        >
          <List className="h-4 w-4" />
        </Btn>
        <Btn
          onClick={() => exec("insertOrderedList")}
          label="Numbered list"
          isActive={active.insertOrderedList}
        >
          <ListOrdered className="h-4 w-4" />
        </Btn>
        <Divider />
        <Btn onClick={addLink} label="Insert link">
          <Link2 className="h-4 w-4" />
        </Btn>
        <Btn
          onClick={() => {
            exec("removeFormat");
            exec("unlink");
          }}
          label="Clear formatting"
        >
          <Eraser className="h-4 w-4" />
        </Btn>
        <Divider />
        <Btn onClick={() => exec("undo")} label="Undo">
          <Undo className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => exec("redo")} label="Redo">
          <Redo className="h-4 w-4" />
        </Btn>
      </div>

      {/* Editable area */}
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2.5 text-sm text-gray-400">
            {placeholder}
          </div>
        )}
        <div
          id={id}
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyUp={syncActive}
          onMouseUp={syncActive}
          className="rte-content min-h-[10rem] w-full px-3 py-2 text-sm text-gray-900 focus:outline-none"
        />
      </div>
    </div>
  );
}
