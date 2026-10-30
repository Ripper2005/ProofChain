import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { Shell } from "./components/Shell.tsx";
import { CustodyPage } from "./pages/CustodyPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { RecallPage } from "./pages/RecallPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { VerifyPage } from "./pages/VerifyPage.tsx";
import { wagmiConfig } from "./wagmi.ts";

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route path="custody" element={<CustodyPage />} />
              <Route path="recall" element={<RecallPage />} />
              <Route path="verify/:chainId/:contractAddress/:batchCode" element={<VerifyPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
