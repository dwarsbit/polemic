import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@/components/EditorView";
import { LibraryView } from "@/components/LibraryView";
import { useProjectStore } from "@/store/project";

const queryClient = new QueryClient();

function App() {
  const hasProject = useProjectStore((s) => s.project !== null);
  return (
    <QueryClientProvider client={queryClient}>
      {hasProject ? <EditorView /> : <LibraryView />}
    </QueryClientProvider>
  );
}

export default App;
