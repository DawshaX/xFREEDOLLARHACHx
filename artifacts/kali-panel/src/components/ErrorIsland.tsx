import React from "react";

/**
 * جزيرة الخطأ — حارس حدود لكل قسم/نافذة.
 * قبلها: أي كراش جوه قسم واحد (زي React #310 بتاع renderBody) كان بيقلّب
 * الشجرة كلها ⇒ الشاشة البيضا اللي كانت بتخبّط المالك. دلوقتي الخطأ يتحبس في
 * القسم نفسه: الهيكل والجمجمة وزراير التحكم يفضلوا أحياء، والقسم يظهر ما
 * حدث بصراحة + زر ارجاع.
 */
interface Props {
  title: string;
  children: React.ReactNode;
}
interface State {
  error: string | null;
  stackHint: string | null;
  retryKey: number;
}

export class ErrorIsland extends React.Component<Props, State> {
  state: State = { error: null, stackHint: null, retryKey: 0 };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { error: err.message || String(err) };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    try {
      this.setState({ stackHint: (info.componentStack || "").split("\n")[1]?.trim() ?? null });
      // سجّلها في كونسول بحيث تبقى مرئية بالتفصيل
      console.error(`[ErrorIsland:${this.props.title}]`, err, info.componentStack);
    } catch { /* */ }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          key={this.state.retryKey}
          className="flex flex-col items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/[0.06] p-6 text-center space-y-3 min-h-[160px]"
          dir="rtl"
        >
          <div className="text-3xl">⚠️</div>
          <div className="text-[13px] font-black text-rose-200">قسم «{this.props.title}» وقّف — لكن البرنامج شغال</div>
          <div className="max-w-md text-[10px] font-mono text-rose-100/60 break-words leading-5">
            {this.state.error}
            {this.state.stackHint ? <span className="block mt-1 opacity-60">{this.state.stackHint}</span> : null}
          </div>
          <button
            onClick={() => this.setState((s) => ({ error: null, stackHint: null, retryKey: s.retryKey + 1 }))}
            className="rounded-lg border border-rose-400/50 bg-rose-500/15 px-4 py-2 text-[11px] font-black text-rose-100 hover:bg-rose-500/25 transition"
          >
            ↻ رجّعه تاني
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

export default ErrorIsland;
