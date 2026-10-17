import { Route, Routes } from 'react-router-dom'
import { CatalogProvider } from './components/CatalogProvider'
import { Find } from './pages/Find'
import { History } from './pages/History'
import { Home } from './pages/Home'
import { VideoPlayer } from './pages/VideoPlayer'

export function LegacyVideoApp() {
  return (
    <CatalogProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/find" element={<Find />} />
        <Route path="/history" element={<History />} />
        <Route path="/video/:id" element={<VideoPlayer />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </CatalogProvider>
  )
}
