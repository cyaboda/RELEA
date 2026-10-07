
document.querySelectorAll('form').forEach(form=>{
  form.addEventListener('submit',(e)=>{
    e.preventDefault();
    alert('RELEA prototype: authentication UI is ready. Connect Supabase Auth next.');
  });
});
