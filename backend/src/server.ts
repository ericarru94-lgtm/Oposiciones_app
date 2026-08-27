import "dotenv/config";
import { crearApp } from "./app";

const app = crearApp();

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});
