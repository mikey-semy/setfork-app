// Глобальный setup vitest. jest-dom матчеры (toBeInTheDocument и пр.) регистрируются
// в expect для всех тестов; в node-тестах не мешают (просто добавляют матчеры).
// Авто-cleanup Testing Library работает через globals:true (afterEach).
import '@testing-library/jest-dom/vitest'
