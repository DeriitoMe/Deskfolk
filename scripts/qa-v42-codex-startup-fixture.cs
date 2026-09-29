using System;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;
static class Fixture {
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr handle,int command);
 [STAThread] static void Main(){
  if(Path.GetFileName(Application.ExecutablePath)=="PetProbe.exe"){
   var file=Path.Combine(Path.GetDirectoryName(Application.ExecutablePath),"counter.txt");
   int n=File.Exists(file)?Int32.Parse(File.ReadAllText(file)):0;File.WriteAllText(file,(n+1).ToString());return;
  }
  var form=new Form();form.Text="Deskfolk startup fixture";form.Opacity=.01;form.ShowInTaskbar=true;form.StartPosition=FormStartPosition.Manual;form.Location=new System.Drawing.Point(-30000,-30000);form.Size=new System.Drawing.Size(10,10);
  var timer=new Timer();timer.Interval=500;timer.Tick+=(s,e)=>{ShowWindow(form.Handle,4);timer.Stop();};timer.Start();
  var expiry=new Timer();expiry.Interval=120000;expiry.Tick+=(s,e)=>form.Close();expiry.Start();Application.Run(form);
 }
}
