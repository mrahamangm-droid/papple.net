import { PublicFooter } from "@/components/PublicFooter";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {children}
      <PublicFooter />
    </>
  );
}
