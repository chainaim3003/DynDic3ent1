import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useSimulation } from "@/hooks/useSimulation";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { AgentCenter } from "@/pages/AgentCenter";
import { ContractManagement } from "@/pages/ContractManagement";
import { RiskAnalytics } from "@/pages/RiskAnalytics";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  const simulation = useSimulation();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="agent-ui-theme">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Layout simulation={simulation}>
              <Routes>
                <Route path="/" element={<Dashboard simulation={simulation} />} />
                <Route path="/agents" element={<AgentCenter simulation={simulation} />} />
                <Route path="/contracts" element={<ContractManagement simulation={simulation} />} />
                <Route path="/risk" element={<RiskAnalytics simulation={simulation} />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
