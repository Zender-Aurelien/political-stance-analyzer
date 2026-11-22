# Build from the repository root: docker build -f backend/Dockerfile -t civic-lens .
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY frontend/JS frontend/JS
COPY frontend/Styles.css frontend/Styles.css
COPY frontend/accessibility frontend/accessibility
COPY frontend/assets frontend/assets
COPY data data
COPY frontend/index.html frontend/index.html
COPY frontend/about.html frontend/about.html
RUN useradd --create-home civic && mkdir -p backend/.cache && chown -R civic:civic /app
USER civic
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
