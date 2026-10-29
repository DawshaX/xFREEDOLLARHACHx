import { Construction } from "lucide-react";
import { PageHeader } from "@/components/Layout";

export function Placeholder({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="glow-card rounded-xl p-16 text-center">
        <Construction className="w-16 h-16 mx-auto text-primary/40 mb-4" />
        <h3 className="text-xl font-bold neon-text mb-2">قريباً</h3>
        <p className="text-sm text-muted-foreground font-mono max-w-md mx-auto">
          هذه الوحدة قيد التطوير. سيتم تفعيلها عبر AI Agent v3 الذي يطوّر النظام
          بنفسه. اطلب من الوكيل بناء هذه الميزة وسيقوم بذلك.
        </p>
      </div>
    </div>
  );
}
