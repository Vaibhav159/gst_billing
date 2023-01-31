cd E:\gst_billing
git pull
pip install -r requirements.txt
python manage.py migrate
start brave 127.0.0.1:8000 & python manage.py runserver