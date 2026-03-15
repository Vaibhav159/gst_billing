export default function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none"
    >
      Skip to main content
    </a>
  );
}
